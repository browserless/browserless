#!/usr/bin/env node --expose-gc
/**
 * Explicit memory-leak check. Boots the real server in-process, drives it
 * through the leak-prone paths (error paths, client disconnects, WebSocket
 * connect/disconnect cycles, 404s, management APIs), forces GC between
 * waves, and reports:
 *
 *  - heap/RSS trend across waves (a leak shows as monotonic growth after
 *    the warmup waves)
 *  - internal structures that must return to baseline (session map, timers,
 *    orphaned-dir queue, limiter queue, file-system cache + write-chains)
 *  - event-listener counts on long-lived emitters (per-request subscribes
 *    show up here)
 *  - leftover browserless data-dirs on disk
 *  - any unhandledRejection/uncaughtException raised while under load
 *
 * Usage: npm run build:ts && node --expose-gc scripts/leak-check.js
 */
import { readdir } from 'fs/promises';
import puppeteer from 'puppeteer-core';

// Must be set before the package import below evaluates Config — default
// logging would otherwise drown the per-wave report lines.
process.env.DEBUG ??= 'quiet';
const { Browserless, Config, Metrics } =
  await import('@browserless.io/browserless');

if (typeof global.gc !== 'function') {
  console.error('Run with --expose-gc: node --expose-gc scripts/leak-check.js');
  process.exit(1);
}

const PORT = 3333;
const TOKEN = 'leak-check';
const HTTP = `http://localhost:${PORT}`;
const WS = `ws://localhost:${PORT}`;
const WAVES = 6;
const WARMUP_WAVES = 2; // JIT, lazy caches, pooled sockets settle here

const processErrors = [];
process.on('unhandledRejection', (err) =>
  processErrors.push(`unhandledRejection: ${err}`),
);
process.on('uncaughtException', (err) =>
  processErrors.push(`uncaughtException: ${err}`),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const settleAndMeasure = async () => {
  // Multiple GC passes pick up objects freed by finalizers in between
  for (let i = 0; i < 3; i++) {
    global.gc();
    await sleep(150);
  }
  const { heapUsed, rss, external } = process.memoryUsage();
  return { external, heapUsed, rss };
};

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)}MB`;

// Run thunks with bounded concurrency; failures are collected, not thrown,
// so one bad request doesn't abort the wave — they're reported in the
// final verdict instead.
const pool = async (thunks, width = 4) => {
  const failures = [];
  const queue = [...thunks];
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (queue.length) {
        const thunk = queue.shift();
        try {
          await thunk();
        } catch (err) {
          failures.push(String(err));
        }
      }
    }),
  );
  return failures;
};

const drain = async (res, expectedStatuses = [200]) => {
  // Consume the body so sockets/streams actually complete
  await res.arrayBuffer().catch(() => undefined);
  if (!expectedStatuses.includes(res.status)) {
    throw new Error(
      `${res.url}: expected status ${expectedStatuses.join('/')}, got ${res.status}`,
    );
  }
  return res;
};

const scenarios = (wave) => [
  // Router + static-fallback + 404 error path
  ...Array.from(
    { length: 30 },
    (_, i) => () =>
      fetch(`${HTTP}/leak-check-nope-${wave}-${i}`).then((r) =>
        drain(r, [404]),
      ),
  ),

  // Unauthorized path (metrics counters, early return)
  ...Array.from(
    { length: 5 },
    () => () =>
      fetch(`${HTTP}/sessions?token=wrong-token`).then((r) => drain(r, [401])),
  ),

  // Management APIs (file-system cache, monitoring, session JSON)
  ...['/metrics', '/pressure', '/sessions', '/config'].map(
    (p) => () => fetch(`${HTTP}${p}?token=${TOKEN}`).then(drain),
  ),

  // Cached version endpoint (one throwaway browser total, not per call)
  () => fetch(`${HTTP}/json/version?token=${TOKEN}`).then(drain),

  // Happy-path browser HTTP route
  ...Array.from(
    { length: 5 },
    (_, i) => () =>
      fetch(`${HTTP}/chromium/content?token=${TOKEN}`, {
        body: JSON.stringify({ html: `<h1>wave ${wave} run ${i}</h1>` }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }).then(drain),
  ),

  // Error path inside a browser route: selector never matches → 400 →
  // page must be torn down by the finally
  ...Array.from(
    { length: 4 },
    () => () =>
      fetch(`${HTTP}/chromium/screenshot?token=${TOKEN}`, {
        body: JSON.stringify({
          html: '<h1>err path</h1>',
          selector: '#does-not-exist',
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }).then((r) => drain(r, [400])),
  ),

  // Client disconnects mid-request: response race must complete the
  // browser and settle the limiter job
  ...Array.from({ length: 3 }, () => async () => {
    const ac = new AbortController();
    const req = fetch(`${HTTP}/chromium/content?token=${TOKEN}`, {
      body: JSON.stringify({
        html: '<h1>abort</h1>',
        waitForTimeout: 3000,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: ac.signal,
    }).then(drain);
    await sleep(250);
    ac.abort();
    await req.catch(() => undefined);
  }),

  // WebSocket lifecycle: connect → use → disconnect (proxyWebSocket,
  // browser launch/close, data-dir create/delete)
  ...Array.from({ length: 4 }, () => async () => {
    const browser = await puppeteer.connect({
      browserWSEndpoint: `${WS}?token=${TOKEN}`,
    });
    // The finally guarantees the WS client disconnects even when page
    // setup throws — a leaked client would hold its server session open
    // and skew the very counters this harness asserts on.
    try {
      const page = await browser.newPage();
      await page.setContent('<h1>ws leak check</h1>');
      await page.close();
    } finally {
      await browser.disconnect().catch(() => undefined);
    }
  }),
];

const countDataDirs = async (dir) =>
  (await readdir(dir).catch(() => [])).length;

const internals = (browserless) => {
  // Protected fields are reachable at runtime; this is a dev-only check
  const manager = browserless['browserManager'];
  const limiter = browserless['limiter'];
  const fileSystem = browserless['fileSystem'];
  const config = browserless['config'];
  return {
    configListeners: config
      .eventNames()
      .reduce((sum, e) => sum + config.listenerCount(e), 0),
    fsCacheEntries: fileSystem['fsMap'].size,
    limiterQueue: limiter.length,
    orphanedDataDirs: manager['orphanedDataDirs'].size,
    sessions: manager['browsers'].size,
    timers: manager['timers'].size,
    writeChains: fileSystem['writeChains'].size,
  };
};

const main = async () => {
  const config = new Config();
  config.setPort(PORT);
  config.setToken(TOKEN);
  config.setConcurrent(10);

  const browserless = new Browserless({ config, metrics: new Metrics() });
  await browserless.start();
  const dataDir = await config.getDataDir();
  console.log(`Server up on :${PORT} — ${WAVES} waves, ~60 requests each\n`);

  const results = [];
  const requestFailures = [];

  for (let wave = 1; wave <= WAVES; wave++) {
    const startedAt = Date.now();
    const failures = await pool(scenarios(wave));
    requestFailures.push(...failures.map((f) => `wave ${wave}: ${f}`));
    // Let in-flight teardown (browser closes, dir deletes) finish
    await sleep(2000);

    const mem = await settleAndMeasure();
    const state = internals(browserless);
    const dataDirs = await countDataDirs(dataDir);
    results.push({ dataDirs, mem, state, wave });

    console.log(
      `wave ${wave}: heap=${mb(mem.heapUsed)} rss=${mb(mem.rss)} ` +
        `sessions=${state.sessions} timers=${state.timers} ` +
        `limiterQueue=${state.limiterQueue} fsCache=${state.fsCacheEntries} ` +
        `writeChains=${state.writeChains} ` +
        `cfgListeners=${state.configListeners} dataDirs=${dataDirs} ` +
        `(${((Date.now() - startedAt) / 1000).toFixed(1)}s, ${failures.length} req errors)`,
    );
  }

  await browserless.stop();
  await sleep(1000);
  const finalMem = await settleAndMeasure();

  // ---- Verdict ----------------------------------------------------------
  console.log('\n--- Analysis ---');
  const measured = results.slice(WARMUP_WAVES);
  const deltas = measured
    .slice(1)
    .map((r, i) => r.mem.heapUsed - measured[i].mem.heapUsed);
  const avgGrowth = deltas.length
    ? deltas.reduce((a, b) => a + b, 0) / deltas.length
    : 0;
  const monotonic = deltas.length > 1 && deltas.every((d) => d > 0);

  const problems = [];
  const warnings = [];
  const last = results[results.length - 1];

  // Only a large, unambiguous average growth is a hard failure. A small
  // monotonic creep across this few measured waves is too noise-sensitive to
  // block CI — GC timing and heap fragmentation alone can produce a short run
  // of positive deltas — so it's surfaced as an advisory warning instead. The
  // structural counters below are the deterministic, hard leak signals.
  if (avgGrowth > 2 * 1024 * 1024) {
    problems.push(
      `heap grows ${mb(avgGrowth)}/wave after warmup (deltas: ${deltas.map(mb).join(', ')})`,
    );
  } else if (monotonic && avgGrowth > 512 * 1024) {
    warnings.push(
      `heap grew monotonically ${mb(avgGrowth)}/wave after warmup (deltas: ${deltas.map(mb).join(', ')}) — below the hard-fail threshold; investigate if it persists across runs`,
    );
  }
  if (last.state.sessions !== 0)
    problems.push(`${last.state.sessions} sessions still tracked`);
  if (last.state.timers !== 0)
    problems.push(`${last.state.timers} keep-until timers still tracked`);
  if (last.state.limiterQueue !== 0)
    problems.push(`limiter queue not drained: ${last.state.limiterQueue}`);
  if (last.state.orphanedDataDirs !== 0)
    problems.push(`${last.state.orphanedDataDirs} orphaned data-dirs queued`);
  if (last.dataDirs > results[0].dataDirs)
    problems.push(
      `data-dirs on disk grew ${results[0].dataDirs} → ${last.dataDirs}`,
    );
  if (last.state.configListeners > results[0].state.configListeners)
    problems.push(
      `config listeners grew ${results[0].state.configListeners} → ${last.state.configListeners}`,
    );
  if (last.state.fsCacheEntries > 5)
    problems.push(`file-system cache has ${last.state.fsCacheEntries} entries`);
  if (last.state.writeChains !== 0)
    problems.push(
      `${last.state.writeChains} file-system write-chains still tracked`,
    );
  problems.push(...requestFailures);
  problems.push(...processErrors);

  console.log(
    `heap growth after warmup: avg ${mb(avgGrowth)}/wave ` +
      `(monotonic: ${monotonic}); post-shutdown heap=${mb(finalMem.heapUsed)}`,
  );

  if (warnings.length) {
    console.log('\nLEAK CHECK WARNINGS (advisory, non-failing):');
    for (const w of warnings) console.log(`  ⚠ ${w}`);
  }

  if (problems.length) {
    console.log('\nLEAK CHECK FAILED:');
    for (const p of problems) console.log(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log('\nLEAK CHECK PASSED: no leak signals detected.');
  process.exit(0);
};

main().catch((err) => {
  console.error('leak-check harness error:', err);
  process.exit(1);
});
