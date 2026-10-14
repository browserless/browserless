import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'mocha';
import { BQLBrowserAPI } from './browser-api.js';

describe('raw CDP browser primitives', () => {
  const cleanup: Array<() => unknown> = [];
  afterEach(async function () {
    this.timeout(10_000);
    for (const clean of cleanup.reverse()) await clean();
    cleanup.length = 0;
  });
  it('work against Chromium', async function () {
    if (!process.env.CHROME_PATH) this.skip();
    this.timeout(30_000);
    const profile = await mkdtemp(join(tmpdir(), 'bql-core-'));
    const chrome = spawn(
      process.env.CHROME_PATH!,
      [
        '--headless',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    cleanup.push(async () => {
      const exited = once(chrome, 'exit');
      chrome.kill('SIGTERM');
      await exited;
      await rm(profile, { recursive: true, force: true, maxRetries: 5 });
    });
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(
        () => reject(new Error('Chromium startup timed out')),
        10_000,
      );
      chrome.stderr.on('data', (chunk) => {
        output += chunk.toString();
        const match = /DevTools listening on (ws:\/\/\S+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      chrome.once('error', reject);
    });
    let authRequests = 0;
    const server = createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      if (req.url === '/auth') {
        authRequests++;
        res.setHeader('Cache-Control', 'no-store');
        if (
          req.headers.authorization !==
          `Basic ${Buffer.from('fixture:password').toString('base64')}`
        ) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="fixture"' });
          res.end('Authentication required');
        } else res.end('Authenticated');
        return;
      }
      if (req.url === '/data') {
        res.end('fixture body');
        return;
      }
      if (req.url === '/script') {
        res.end('window.injected = 42;');
        return;
      }
      res.end(`<!doctype html><html><head><title>Core fixture</title></head><body>
      <h1>Heading</h1><section id="read"><b>Hello</b></section>
      <button id="click" onclick="window.clicks=(window.clicks||0)+1">Click</button>
      <input id="input"><input id="check" type="checkbox">
      <select id="select"><option value="a">A</option><option value="b">B</option></select>
      <div id="host"></div><div style="height:2000px"></div>
      <script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML='<button id="shadow">Shadow</button>'; document.querySelector('#input').addEventListener('keydown',()=>window.keys=(window.keys||0)+1);</script>
      </body></html>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const api = new BQLBrowserAPI({
      browser: { wsEndpoint: () => endpoint } as any,
      config: {} as any,
      logger: { error() {} } as any,
      req: {} as any,
      blockConsentModals: false,
    });
    cleanup.push(() => api.close());
    await api.start();
    api.preferences({ timeout: 3000 });
    assert.equal((await api.goto({ url: origin })).status, 200);
    await api.ensureConsoleCapture();
    const consoleEvents = api.streamEvents<{ text: string; args: string[] }>(
      'console',
    );
    await api.evaluate({ content: 'console.log("fixture", null, 42)' });
    const consoleEvent = (await consoleEvents.next()).value;
    assert.equal(consoleEvent.text, 'fixture null 42');
    assert.deepEqual(consoleEvent.args, ['"fixture"', 'null', '42']);
    await consoleEvents.return(undefined);
    await api.authenticate({
      username: 'fixture',
      password: 'password',
      origin: 'https://example.com',
    });
    assert.equal(
      (
        await api.evaluate({
          content:
            "fetch('/auth').then(async r => { await r.text(); return r.status; })",
        })
      ).value,
      401,
    );
    assert.equal(authRequests, 1);
    authRequests = 0;
    await api.authenticate({ username: 'fixture', password: 'wrong', origin });
    assert.equal(
      (
        await api.evaluate({
          content:
            "fetch('/auth').then(async r => { await r.text(); return r.status; })",
        })
      ).value,
      401,
    );
    assert.equal(authRequests, 2);
    await api.authenticate({
      username: 'fixture',
      password: 'password',
      origin,
    });
    assert.equal(
      (
        await api.evaluate({
          content:
            "fetch('/auth').then(async r => { await r.text(); return r.status; })",
        })
      ).value,
      200,
    );
    assert.equal(
      await api.getBoundingClientRect({ selector: '.missing' }),
      null,
    );
    assert.equal((await api.title()).value, 'Core fixture');
    assert.equal((await api.url()).value, `${origin}/`);
    assert.equal(
      (await api.querySelector({ selector: '#shadow' })).innerText,
      'Shadow',
    );
    assert.equal(
      (await api.querySelectorAll({ selector: 'button' })).length,
      2,
    );
    await assert.rejects(
      api.querySelector({ selector: '< iframe button' }),
      /not supported/,
    );
    await api.click({
      selector: '#click',
      visible: true,
      wait: true,
      scroll: true,
    });
    assert.equal((await api.evaluate({ content: 'window.clicks' })).value, 1);
    await api.type({
      selector: '#input',
      text: 'hello',
      visible: true,
      wait: true,
    });
    assert.equal(
      (
        await api.evaluate({
          content: "document.querySelector('#input').value",
        })
      ).value,
      'hello',
    );
    assert.equal((await api.evaluate({ content: 'window.keys' })).value, 5);
    await api.checkbox({ selector: '#check', checked: true });
    await api.checkbox({ selector: '#check', checked: true });
    assert.equal(
      (
        await api.evaluate({
          content: "document.querySelector('#check').checked",
        })
      ).value,
      true,
    );
    assert.deepEqual(
      (await api.select({ selector: '#select', value: 'b' })).value,
      ['b'],
    );
    await api.hover({ selector: '#click', scroll: true });
    await api.scroll({ y: 100 });
    assert.equal(
      (await api.html({ selector: '#read' })).html,
      '<b xmlns="http://www.w3.org/1999/xhtml">Hello</b>',
    );
    assert.equal((await api.text({ selector: '#read' })).text, 'Hello');
    assert.match(
      (await api.markdown({ selector: 'body' })).markdown,
      /^# Heading\n/,
    );
    assert.equal(
      (await api.mapSelector({ selector: 'button', wait: true }))[0].attribute({
        name: 'id',
      }).value,
      'click',
    );
    await api.addScriptTag({ content: 'window.tag = true' });
    await api.addStyleTag({ content: 'body { background: rgb(1, 2, 3); }' });
    assert.equal((await api.evaluate({ url: `${origin}/script` })).value, 42);
    assert.equal(
      (await api.evaluate({ content: 'window.injected' })).value,
      42,
    );
    await api.watchEvent({ event: 'fixture' });
    await api.evaluate({
      content: "window.dispatchEvent(new Event('fixture'))",
    });
    await api.waitForEvent({ event: 'fixture' });
    await api.waitForFunction({
      fn: '() => window.tag === true',
      pollingType: 'raf',
    });
    await api.viewport({ width: 800, height: 600, hasTouch: true });
    await api.emulateMediaType({ type: 'print' });
    assert.equal(
      (await api.evaluate({ content: "matchMedia('print').matches" })).value,
      true,
    );
    const screenshot = await api.screenshot({
      options: { type: 'png', fullPage: true },
    });
    assert.equal(
      Buffer.from(screenshot.base64, 'base64').subarray(1, 4).toString(),
      'PNG',
    );
    const pdf = await api.pdf({
      options: { format: 'a4', marginTop: '1cm', waitForFonts: true },
    });
    assert.equal(
      Buffer.from(pdf.base64, 'base64').subarray(0, 4).toString(),
      '%PDF',
    );
    await api.cookies({
      cookies: [{ name: 'fixture', value: 'ok', url: origin }],
    });
    assert.equal(
      (await api.cookies()).cookies.find((c) => c.name === 'fixture')?.value,
      'ok',
    );
    await api.setExtraHTTPHeaders({
      headers: [{ name: 'X-Fixture', value: 'yes' }],
    });
    await api.userAgent({ userAgent: 'Core fixture browser' });
    await api.fulfill({
      url: ['*/data'],
      operator: 'or',
      status: 202,
      body: 'intercepted',
      contentType: 'text/plain',
    });
    const responseEvents = api.streamEvents<{ id: string; status: number }>(
      'response',
    );
    await api.evaluate({
      content: "fetch('/data').then(r=>r.text()).then(v=>window.body=v)",
    });
    const responseEvent = (await responseEvents.next()).value;
    assert.equal(responseEvent.status, 202);
    assert.equal(
      (await api.getResponseBody(responseEvent.id))?.body,
      'intercepted',
    );
    await responseEvents.return(undefined);
    assert.equal(
      (await api.evaluate({ content: 'window.body' })).value,
      'intercepted',
    );
    const requests = await api.request({ url: ['*/data'], wait: true });
    assert.equal(
      requests?.[0].headers.find((h) => h.name.toLowerCase() === 'x-fixture')
        ?.value,
      'yes',
    );
    assert.equal(
      (await api.response({ url: ['*/data'], wait: true }))?.[0].status,
      202,
    );
    await api.reject({ enabled: true, url: ['*/blocked'], operator: 'or' });
    assert.equal(
      (
        await api.evaluate({
          content: "fetch('/blocked').then(()=>false,()=>true)",
        })
      ).value,
      true,
    );
    await api.reject({ enabled: false });
    await api.waitForNetworkIdle({ idleTime: 10 });
    await api.goto({ url: `${origin}/second`, waitUntil: 'domContentLoaded' });
    assert.equal((await api.back({ waitUntil: 'load' }))?.url, `${origin}/`);
    assert.equal(
      (await api.forward({ waitUntil: 'load' }))?.url,
      `${origin}/second`,
    );
    await api.reload({ waitUntil: 'load' });
    const created = await api.browserCDP.send('Target.createTarget', {
      url: `${origin}/window`,
    });
    assert.equal(
      (
        await api.switchToWindow({
          targetId: created.targetId,
          waitUntil: 'load',
        })
      ).success,
      true,
    );
    assert.equal((await api.url()).value, `${origin}/window`);
    const latest = await api.browserCDP.send('Target.createTarget', {
      url: `${origin}/newest`,
    });
    assert.equal(
      (await api.switchToWindow({ newest: true, waitUntil: 'load' })).success,
      true,
    );
    assert.equal(api.getCurrentTargetId(), latest.targetId);
    assert.equal(
      (
        await api.content({
          html: '<html><body><h1>New content</h1></body></html>',
          waitUntil: 'load',
        })
      ).status,
      200,
    );
    assert.equal((await api.text({ selector: 'h1' })).text, 'New content');
    await api.reject({ enabled: true, url: ['*/blocked-document'] });
    const rejected = await api.goto({ url: `${origin}/blocked-document` });
    assert.equal(rejected.rejected, true);
    assert.equal(rejected.status, null);
    await api.javaScriptEnabled({ enabled: false });
    const disconnected = new Promise<void>((resolve) =>
      api.onDisconnected(resolve),
    );
    api.browserCDP.dispose();
    await disconnected;
    assert.equal(api.hasErrored(), true);
  });
});
