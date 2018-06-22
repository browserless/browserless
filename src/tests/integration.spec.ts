import * as puppeteer from 'puppeteer';
import { BrowserlessServer } from '../browserless-server';

const defaultParams = {
  chromeRefreshTime: 0,
  connectionTimeout: 2000,
  demoMode: false,
  enableDebugger: true,
  healthFailureURL: null,
  keepAlive: false,
  maxCPU: 100,
  maxChromeRefreshRetries: 1,
  maxConcurrentSessions: 1,
  maxMemory: 100,
  maxQueueLength: 2,
  metricsJSONPath: null,
  port: 3000,
  prebootChrome: false,
  queuedAlertURL: null,
  rejectAlertURL: null,
  timeoutAlertURL: null,
  token: null,
};

const sleep = (time = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

const throws = () => {
  throw new Error(`Shouldn't have thrown`);
};

describe('Browserless Chrome', () => {
  let browserless = null;
  const start = (args) => {
    return browserless = new BrowserlessServer(args);
  };

  afterEach(async () => {
    browserless.close();
  });

  describe('WebSockets', () => {
    it('runs concurrently', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 2,
      });
      await browserless.startServer();

      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:${defaultParams.port}`,
        });

        return browser.close();
      };

      await Promise.all([
        job(),
        job(),
      ]);

      await sleep(50);

      expect(browserless.currentStat.successful).toEqual(2);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(0);
    });

    it('queues requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 1,
      });
      await browserless.startServer();

      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:${defaultParams.port}`,
        });

        return browser.close();
      };

      await Promise.all([
        job(),
        job(),
      ]);

      await sleep(50);

      expect(browserless.currentStat.successful).toEqual(2);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(1);
    });

    it('fails requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` })
        .then(throws)
        .catch((error) => {
          expect(browserless.currentStat.successful).toEqual(0);
          expect(browserless.currentStat.rejected).toEqual(1);
          expect(browserless.currentStat.queued).toEqual(0);
          expect(error.message).toEqual(`socket hang up`);
        });
    });

    it('fails requests in demo mode', async () => {
      const browserless = start({
        ...defaultParams,
        demoMode: true,
      });

      await browserless.startServer();

      return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` })
        .then(throws)
        .catch((error) => {
          expect(browserless.currentStat.successful).toEqual(0);
          expect(browserless.currentStat.rejected).toEqual(1);
          expect(browserless.currentStat.queued).toEqual(0);
          expect(error.message).toEqual(`socket hang up`);
        });
    });

    it('fails requests without tokens', async () => {
      const browserless = start({
        ...defaultParams,
        token: 'abc',
      });

      await browserless.startServer();

      return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` })
        .then(throws)
        .catch((error) => {
          expect(browserless.currentStat.successful).toEqual(0);
          expect(browserless.currentStat.rejected).toEqual(1);
          expect(browserless.currentStat.queued).toEqual(0);
          expect(error.message).toEqual(`socket hang up`);
        });
    });

    it('pre-boots chrome to match concurrency', async () => {
      const conncurent = 2;
      const browserless: any = start({
        ...defaultParams,
        maxConcurrentSessions: conncurent,
        prebootChrome: true,
      });

      await browserless.startServer();

      expect(browserless.chromeService.chromeSwarm).toHaveLength(conncurent);
    });

    it.skip('closes chrome when the socket is closed');
  });

  describe('HTTP', () => {
    it.skip('allows requests to /json/version');
    it.skip('allows requests to /introspection');
    it.skip('allows requests to /json/protocol');
    it.skip('allows requests to /metrics');
    it.skip('allows requests to /config');
    it.skip('allows requests to /pressure');
    it.skip('allows requests to /function');
    it.skip('allows requests to /screenshot');
    it.skip('allows requests to /content');
    it.skip('allows requests to /pdf');
  });
});
