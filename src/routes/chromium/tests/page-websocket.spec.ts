import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { expect } from 'chai';

// Sends a single CDP command over a raw WebSocket, resolving with the response
// to that command, or rejecting when the connection can't be established. The
// page proxy also forwards CDP events, so responses are matched on their id.
const cdpSend = (url: string, method: string) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('error', reject);
    ws.once('open', () => ws.send(JSON.stringify({ id: 1, method })));
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.id !== 1) return;
        ws.close();
        resolve(message);
      } catch (err: unknown) {
        ws.close();
        reject(err);
      }
    });
  });

describe('WebSocket Page API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('forwards requests to running pages', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/${pageId}`;

    // Connect to raw page target and send a command
    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    await browser.close();
    expect(result);
  });

  it('creates the page at the URL supplied to /json/new', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const target = 'http://localhost:3000/docs/';
    const { webSocketDebuggerUrl } = await fetch(
      `http://localhost:3000/json/new?${target}`,
      { method: 'PUT' },
    ).then((r) => r.json());

    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    try {
      const actualURL = await new Promise<string>((resolve, reject) => {
        const startedAt = Date.now();
        let id = 0;

        const poll = () => {
          if (Date.now() - startedAt > 10_000) {
            reject(new Error('Timed out waiting for /json/new navigation'));
            return;
          }
          ws.send(
            JSON.stringify({ id: ++id, method: 'Page.getNavigationHistory' }),
          );
        };

        ws.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (!message.id || !message.result?.entries) return;

          const history = message.result;
          const url = history.entries[history.currentIndex]?.url;
          if (url === target) {
            resolve(url);
          } else {
            setTimeout(poll, 100);
          }
        });

        poll();
      });

      expect(actualURL).to.equal(target);
    } finally {
      ws.close();
    }
  });

  it('rejects non-HTTP(S) targets on direct page WebSockets', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const { webSocketDebuggerUrl } = await fetch(
      'http://localhost:3000/json/new',
      { method: 'PUT' },
    ).then((r) => r.json());
    const directURL = new URL(webSocketDebuggerUrl);
    directURL.searchParams.set('url', 'data:text/html,test');

    let error: Error | undefined;
    try {
      await cdpSend(directURL.href, 'Page.enable');
    } catch (err) {
      error = err as Error;
    }

    expect(error?.message).to.include('400');
  });

  it('rejects unauthorized page requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/${pageId}`;

    // Connect to raw page target without authorization
    try {
      await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    } catch (err: unknown) {
      //@ts-ignore
      expect(err.message).to.include('401');
    } finally {
      browser.close();
    }
  });

  it('404s pages not found', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/im-a-banana`;

    // Connect to raw page target without authorization
    try {
      await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    } catch (err: unknown) {
      //@ts-ignore
      expect(err.message).to.include('404');
    } finally {
      browser.close();
    }
  });
});
