import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { expect } from 'chai';

// Sends a single CDP command over a raw WebSocket, resolving with the
// response, or rejecting when the connection can't be established.
const cdpSend = (url: string, method: string) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('error', reject);
    ws.once('open', () => ws.send(JSON.stringify({ id: 1, method })));
    ws.once('message', (data) => {
      ws.close();
      resolve(JSON.parse(data.toString()));
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
      browserWSEndpoint: `ws://localhost:3000/edge`,
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

  it('creates pages when interacting with /json/new', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const { webSocketDebuggerUrl } = await fetch(
      'http://localhost:3000/json/new',
      {
        method: 'PUT',
      },
    ).then((r) => r.json());

    // Connect to raw page target and send a command
    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    expect(result);
  });

  it('rejects unauthorized page requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/edge?token=browserless`,
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
      browserWSEndpoint: `ws://localhost:3000/edge?token=browserless`,
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
