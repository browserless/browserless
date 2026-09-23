import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { expect } from 'chai';
import { randomUUID } from 'crypto';

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

const cdpConnectError = async (url: string): Promise<Error | null> => {
  try {
    await cdpSend(url, 'Page.enable');
    return null;
  } catch (err: unknown) {
    return err as Error;
  }
};

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
    const port = config.getPort();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:${port}`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:${port}/devtools/page/${pageId}`;

    // Connect to raw page target and send a command
    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    await browser.close();
    expect(result);
  });

  it('creates pages when interacting with /json/new', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });
    const port = config.getPort();

    const { webSocketDebuggerUrl } = await fetch(
      `http://localhost:${port}/json/new`,
      {
        method: 'PUT',
      },
    ).then((r) => r.json());

    // Connect to raw page target and send a command
    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    expect(result);
  });

  it('creates pages from BLESS page URLs without a configured token', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });
    const webSocketDebuggerUrl = `ws://localhost:${config.getPort()}/devtools/page/BLESS${randomUUID()}`;

    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    expect(result).to.have.property('id', 1);
  });

  it('rejects unauthorized page requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const port = config.getPort();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:${port}?token=browserless`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:${port}/devtools/page/${pageId}`;

    // Connect to raw page target without authorization
    const connectError = await cdpConnectError(webSocketDebuggerUrl);
    await browser.close();
    expect(
      connectError,
      'expected the tokenless page connect to be rejected, but it succeeded',
    ).to.not.equal(null);
    expect(connectError!.message).to.include('401');
  });

  it('requires authorization when creating pages from BLESS page URLs', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const webSocketDebuggerUrl = `ws://localhost:${config.getPort()}/devtools/page/BLESS${randomUUID()}`;

    const connectError = await cdpConnectError(webSocketDebuggerUrl);
    expect(
      connectError,
      'expected the tokenless page connect to be rejected, but it succeeded',
    ).to.not.equal(null);
    expect(connectError!.message).to.include('401');

    const result = await cdpSend(
      `${webSocketDebuggerUrl}?token=browserless`,
      'Page.enable',
    );
    expect(result).to.have.property('id', 1);
  });

  it('404s pages not found', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const port = config.getPort();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:${port}?token=browserless`,
    });
    const page = await browser.newPage();
    await page.goto('https://one.one.one.one/');
    const webSocketDebuggerUrl = `ws://localhost:${port}/devtools/page/im-a-banana?token=browserless`;

    const connectError = await cdpConnectError(webSocketDebuggerUrl);
    await browser.close();
    expect(
      connectError,
      'expected the unknown page connect to be rejected, but it succeeded',
    ).to.not.equal(null);
    expect(connectError!.message).to.include('404');
  });
});
