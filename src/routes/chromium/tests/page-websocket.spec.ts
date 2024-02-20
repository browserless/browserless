import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import puppeteer, { Connection } from 'puppeteer-core';
import { NodeWebSocketTransport } from 'puppeteer-core/lib/esm/puppeteer/node/NodeWebSocketTransport.js';
import { expect } from 'chai';

describe('WebSocket Page API', function () {
  // Server shutdown can take a few seconds
  // and so can these tests :/
  this.timeout(5000);

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
    await page.goto('https://example.com/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/${pageId}`;

    // Connect to raw page target
    const cdp = new Connection(
      webSocketDebuggerUrl,
      await NodeWebSocketTransport.create(webSocketDebuggerUrl),
    );

    // Send a command
    const result = await cdp.send('Page.enable');
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

    // Connect to raw page target
    const cdp = new Connection(
      webSocketDebuggerUrl,
      await NodeWebSocketTransport.create(webSocketDebuggerUrl),
    );

    // Send a command
    const result = await cdp.send('Page.enable');
    cdp.dispose();
    expect(result);
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
    await page.goto('https://example.com/');
    // @ts-ignore
    const pageId = page.target()._targetId;
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/${pageId}`;

    // Connect to raw page target without authorization
    try {
      new Connection(
        webSocketDebuggerUrl,
        await NodeWebSocketTransport.create(webSocketDebuggerUrl),
      );
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
    await page.goto('https://example.com/');
    const webSocketDebuggerUrl = `ws://localhost:3000/devtools/page/im-a-banana`;

    // Connect to raw page target without authorization
    try {
      new Connection(
        webSocketDebuggerUrl,
        await NodeWebSocketTransport.create(webSocketDebuggerUrl),
      );
    } catch (err: unknown) {
      //@ts-ignore
      expect(err.message).to.include('404');
    } finally {
      browser.close();
    }
  });
});
