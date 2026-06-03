#!/usr/bin/env node
//
// changelog-browser-versions.js
//
// Emits the "Supports the following libraries and browsers:" block for the
// CHANGELOG by introspecting a built browserless image, so the versions in a
// release reflect what actually shipped rather than a hand-typed guess.
//
// It runs ONE container off the multi image and, inside it:
//   - reads puppeteer-core + the pinned playwright-core versions from
//     package.json (the same logic the GET /meta route uses), and
//   - launches every browser via playwright-core and reads browser.version()
//     straight from the running binary (chromium, the chrome + msedge stable
//     channels, firefox, and webkit).
//
// Usage:
//   node scripts/changelog-browser-versions.js [--image <ref>] [--platform <p>] [--no-pull]
//
// Defaults: --image ghcr.io/browserless/multi:latest  --platform linux/amd64
//
// Chrome and Edge are linux/amd64 only (their stable channels are not built for
// arm64); chromium/firefox/webkit are pinned by Playwright and identical across
// architectures. Running the amd64 image therefore yields the full block; an
// arm64 run (--platform linux/arm64, needs qemu/binfmt locally) reconfirms the
// shared three and reports Chrome/Edge as unavailable.

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const getFlag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const image = getFlag('--image', 'ghcr.io/browserless/multi:latest');
const platform = getFlag('--platform', 'linux/amd64');
const pull = !args.includes('--no-pull');

// Runs inside the container as an ES module (`node --input-type=module -e`).
// Prints a single JSON line to stdout; any diagnostics go to stderr so they
// don't pollute it.
const PROBE = `
import { chromium, firefox, webkit } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
const semver = (s) => String(s || '').replace(/[\\^~>=<*\\s]/g, '');
const puppeteer = semver(pkg.dependencies['puppeteer-core']);
const playwrightCore = semver(pkg.dependencies['playwright-core']);
// Mirror src/routes/management/http/meta.get.ts: resolve each pinned alias to
// its dependency spec, pull the version out, then de-dupe (insertion order).
const playwright = [...new Set(
  Object.values(pkg.playwrightVersions || {})
    .map((alias) => pkg.dependencies[alias])
    .filter(Boolean)
    .map((v) => (v.match(/[0-9.]+/g) || []).join(''))
    .concat(playwrightCore),
)];

// browser.version() is e.g. "HeadlessChrome/148.0.7778.96" or "Firefox/150.0.2";
// keep only the version after the product slash.
const strip = (v) => ((v && v.includes('/') ? v.split('/').pop() : v) || null);
const versionOf = async (type, opts) => {
  let browser;
  try {
    browser = await type.launch(opts);
    return strip(browser.version());
  } catch {
    return null;
  } finally {
    await browser?.close();
  }
};

const sandbox = { args: ['--no-sandbox'] };
const out = {
  puppeteer,
  playwright,
  chromium: await versionOf(chromium, sandbox),
  chrome: await versionOf(chromium, { channel: 'chrome', ...sandbox }),
  edge: await versionOf(chromium, { channel: 'msedge', ...sandbox }),
  firefox: await versionOf(firefox, {}),
  webkit: await versionOf(webkit, {}),
};
console.log(JSON.stringify(out));
`;

const dockerArgs = [
  'run',
  '--rm',
  '--platform',
  platform,
  ...(pull ? ['--pull', 'always'] : []),
  '--entrypoint',
  'node',
  image,
  '--input-type=module',
  '-e',
  PROBE,
];

// spawnSync with an argv array (no shell) — PROBE is passed verbatim, so there
// is nothing to escape.
const result = spawnSync('docker', dockerArgs, { encoding: 'utf8' });

if (result.error) {
  console.error(`Failed to run docker: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`docker run exited ${result.status}\n${result.stderr}`);
  process.exit(result.status || 1);
}

let data;
try {
  // The probe prints exactly one JSON line; take the last non-empty stdout line
  // to be resilient to any stray container output.
  const line = result.stdout.trim().split('\n').filter(Boolean).pop();
  data = JSON.parse(line);
} catch (err) {
  console.error(
    `Could not parse probe output: ${err.message}\nstdout:\n${result.stdout}`,
  );
  process.exit(1);
}

// "a, b, and c." — Oxford-comma list with a trailing period, matching the
// existing CHANGELOG style. A single entry is just "a.".
const sentenceList = (items) => {
  const v = items.map((x) => `\`${x}\``);
  if (v.length === 1) return `${v[0]}.`;
  if (v.length === 2) return `${v[0]} and ${v[1]}.`;
  return `${v.slice(0, -1).join(', ')}, and ${v[v.length - 1]}.`;
};

const tick = (version) => (version ? `\`${version}\`` : '`<unavailable>`');
const amd64Only = (version) => `${tick(version)} (amd64 only)`;

for (const [name, value] of [
  ['Chromium', data.chromium],
  ['Firefox', data.firefox],
  ['Webkit', data.webkit],
]) {
  if (!value) console.error(`WARN: ${name} version unavailable.`);
}
if (!data.chrome)
  console.error(
    'WARN: Chrome version unavailable (expected on a non-amd64 image).',
  );
if (!data.edge)
  console.error(
    'WARN: Edge version unavailable (expected on a non-amd64 image).',
  );

const block = [
  '- Supports the following libraries and browsers:',
  `  - puppeteer-core: \`${data.puppeteer}\``,
  `  - playwright-core: ${sentenceList(data.playwright)}`,
  `  - Chromium: ${tick(data.chromium)}`,
  `  - Chrome: ${amd64Only(data.chrome)}`,
  `  - Firefox: ${tick(data.firefox)}`,
  `  - Webkit: ${tick(data.webkit)}`,
  `  - Edge: ${amd64Only(data.edge)}`,
].join('\n');

process.stdout.write(block + '\n');
