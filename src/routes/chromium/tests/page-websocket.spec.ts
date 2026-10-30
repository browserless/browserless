import {
  Browserless,
  ChromeCDP,
  Config,
  Metrics,
  pageID,
  availableBrowsers,
} from '@browserless.io/browserless';
import puppeteer from 'puppeteer-core';
import { WebSocket } from 'ws';
import { expect } from 'chai';

// Sends a single CDP command over a raw WebSocket, resolving with the response
// to that command, or rejecting when the connection can't be established. The
// page proxy also forwards CDP events, so responses are matched on their id.
const cdpSend = (url: string, method: string) =>
  new Promise<{ id: number }>((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('error', reject);
    ws.once('close', (code) =>
      reject(new Error(`Socket closed (${code}) before a reply`)),
    );
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

// Resolves with the connection error, or null when the command was answered,
// so callers assert outside of a try/catch that could swallow the assertion.
const cdpError = (url: string) =>
  cdpSend(url, 'Page.enable').then(
    () => null,
    (err: Error) => err,
  );

describe('WebSocket Page API', function () {
  let browserless: Browserless;
  let port: number;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    port = config.getPort();
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  const openPage = async (token?: string) => {
    const query = token ? `?token=${token}` : '';
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:${port}${query}`,
    });
    const page = await browser.newPage();
    // @ts-ignore
    const pageId: string = page.target()._targetId;
    return { browser, pageId };
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('forwards requests to running pages', async () => {
    await start();

    const { browser, pageId } = await openPage();
    const result = await cdpSend(
      `ws://localhost:${port}/devtools/page/${pageId}`,
      'Page.enable',
    );
    await browser.close();
    expect(result.id).to.equal(1);
  });

  it('creates the page at the URL supplied to /json/new', async () => {
    await start();

    const target = `http://localhost:${port}/docs/`;
    const { webSocketDebuggerUrl } = await fetch(
      `http://localhost:${port}/json/new?${target}`,
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
    await start();

    const { webSocketDebuggerUrl } = await fetch(
      `http://localhost:${port}/json/new`,
      { method: 'PUT' },
    ).then((r) => r.json());
    const directURL = new URL(webSocketDebuggerUrl);
    directURL.searchParams.set('url', 'data:text/html,test');

    const error = await cdpError(directURL.href);
    expect(error?.message).to.include('400');
  });

  it('creates pages when interacting with /json/new', async () => {
    await start();

    const { webSocketDebuggerUrl } = await fetch(
      `http://localhost:${port}/json/new`,
      {
        method: 'PUT',
      },
    ).then((r) => r.json());

    const result = await cdpSend(webSocketDebuggerUrl, 'Page.enable');
    expect(result.id).to.equal(1);
  });

  it('rejects unauthorized page requests unless chrome serves the route', async () => {
    const config = new Config();
    config.setToken('browserless');
    await start({ config });

    const { browser, pageId } = await openPage('browserless');
    const connectError = await cdpError(
      `ws://localhost:${port}/devtools/page/${pageId}`,
    );
    await browser.close();

    // chrome, chromium and edge all register /devtools/page/* and the first
    // registered wins. When chrome is installed its page route (auth = false)
    // answers for chromium pages too, as in the multi image.
    if ((await availableBrowsers).includes(ChromeCDP)) {
      expect(connectError, 'expected chrome to serve it tokenless').to.equal(
        null,
      );
      return;
    }
    expect(connectError?.message, 'expected a 401').to.include('401');
  });

  it('404s pages not found', async () => {
    await start();

    const connectError = await cdpError(
      `ws://localhost:${port}/devtools/page/im-a-banana`,
    );
    expect(connectError?.message, 'expected a 404').to.include('404');
  });

  describe('STRICT_TOKEN_USE', () => {
    const startStrict = () => {
      const config = new Config();
      config.setToken('browserless');
      config.setStrictTokenUse(true);
      return start({ config });
    };

    it('rejects tokenless connects to running pages', async () => {
      await startStrict();

      const { browser, pageId } = await openPage('browserless');
      const connectError = await cdpError(
        `ws://localhost:${port}/devtools/page/${pageId}`,
      );
      await browser.close();
      expect(connectError?.message, 'expected a 401').to.include('401');
    });

    it('rejects tokenless connects that would spawn a page', async () => {
      await startStrict();

      const connectError = await cdpError(
        `ws://localhost:${port}/devtools/page/${pageID()}`,
      );
      expect(connectError?.message, 'expected a 401').to.include('401');
    });

    it('allows connects that carry the token', async () => {
      await startStrict();

      const { browser, pageId } = await openPage('browserless');
      const running = await cdpSend(
        `ws://localhost:${port}/devtools/page/${pageId}?token=browserless`,
        'Page.enable',
      );
      await browser.close();
      const spawned = await cdpSend(
        `ws://localhost:${port}/devtools/page/${pageID()}?token=browserless`,
        'Page.enable',
      );
      expect(running.id).to.equal(1);
      expect(spawned.id).to.equal(1);
    });
  });
});
