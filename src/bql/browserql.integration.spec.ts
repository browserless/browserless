import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type ServerResponse } from 'node:http';
import puppeteer from 'puppeteer-core';
import { BrowserQL } from './browserql.js';
import type { BQLContextOptions } from './context.js';

describe('BrowserQL browser execution', () => {
  it('switches at the requested current-document milestone, including already loaded targets', async function () {
    if (!process.env.CHROME_PATH) this.skip();
    this.timeout(30_000);
    let image: ServerResponse | undefined;
    const server = createServer((req, res) => {
      if (req.url === '/image') {
        image = res;
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end('<title>Next</title><img src="/image">');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as { port: number };
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const context = new BrowserQL().createContext({
      browser: { wsEndpoint: () => browser.wsEndpoint() },
      config: {},
      logger: { error() {} },
      req: {},
      blockConsentModals: false,
    } as BQLContextOptions);
    try {
      const api = await context.getBrowser();
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: 'domcontentloaded',
      });
      const target = (await api.listPageTargets()).find(
        (t) => t.url === page.url(),
      )!;
      assert.equal(
        (
          await api.switchToWindow({
            targetId: target.id,
            waitUntil: 'domContentLoaded',
            timeout: 1000,
          })
        ).success,
        true,
      );
      assert.equal(
        (
          await api.switchToWindow({
            targetId: target.id,
            waitUntil: 'load',
            timeout: 100,
          })
        ).success,
        false,
      );
      image!.end();
      await page.waitForFunction(() => document.readyState === 'complete');
      for (const waitUntil of [
        'commit',
        'domContentLoaded',
        'load',
        'networkIdle',
      ] as const) {
        assert.equal(
          (
            await api.switchToWindow({
              targetId: target.id,
              waitUntil,
              timeout: 3000,
            })
          ).success,
          true,
          waitUntil,
        );
      }
    } finally {
      image?.end();
      await context.close();
      await browser.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('executes core contracts, exports, nested conditions, extensions and discovery against Chromium', async function () {
    if (!process.env.CHROME_PATH) this.skip();
    this.timeout(30_000);
    const service = new BrowserQL({
      modules: [
        {
          name: 'test',
          typeDefs: 'extend type Mutation { extension: TitleResponse }',
          resolvers: {
            Mutation: {
              extension: async (_source, _args, context) => ({
                title: (await (await context.getBrowser()).title()).value,
              }),
            },
          },
        },
      ],
    });
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><title>Schema fixture</title><input id="input"><h1>Readback</h1>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const context = service.createContext({
      browser: { wsEndpoint: () => browser.wsEndpoint() },
      config: {},
      logger: { error() {} },
      req: {},
      blockConsentModals: false,
    } as BQLContextOptions);
    try {
      const result = await service.execute(
        {
          query: `mutation {
        preferences(timeout:3000) { timeout }
        goto(url:"${origin}",waitUntilAll:[load,domContentLoaded]) { status }
        title { title @export(as:"title") }
        type(selector:"#input",text:"\${title}",delay:[0,0]) { time }
        value:evaluate(content:"document.querySelector('#input').value") { value }
        if(selector:"h1") { extension { title } ifnot(selector:"#absent") { text(selector:"h1") { text } } }
        ifnot(selector:"h1") { evaluate(content:"throw new Error('must not run')") { value } }
        missing:if(selector:"#absent") { title { title } }
        setExtraHTTPHeaders(headers:[{name:"X-Test",value:"ok"}]) { headers { name value } }
        reload { status }
        waitForResponse(statuses:[200]) { status }
      }`,
        },
        context,
      );
      assert.equal(result.errors, undefined, JSON.stringify(result.errors));
      const data = JSON.parse(JSON.stringify(result.data));
      assert.equal(data.goto.status, 200);
      assert.equal(data.value.value, 'Schema fixture');
      assert.equal(data.if.extension.title, 'Schema fixture');
      assert.equal(data.if.ifnot.text.text, 'Readback');
      assert.equal(data.ifnot, null);
      assert.equal(data.missing, null);
      assert.deepEqual(data.setExtraHTTPHeaders.headers, [
        { name: 'X-Test', value: 'ok' },
      ]);
      assert.equal(data.reload.status, 200);
      assert.equal(data.waitForResponse.status, 200);
      const discovery = await service.execute(
        { query: '{ browser capabilities }' },
        context,
      );
      assert.equal(discovery.errors, undefined);
      assert.match(String(discovery.data?.browser), /Chrome/);
      assert.deepEqual(discovery.data?.capabilities, ['core', 'test']);
    } finally {
      await context.close();
      await browser.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
