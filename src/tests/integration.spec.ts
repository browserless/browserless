import * as puppeteer from 'puppeteer';
import { BrowserlessServer } from '../browserless-server';

const defaultParams = {
  autoQueue: false,
  chromeRefreshTime: 0,
  connectionTimeout: 2000,
  demoMode: false,
  enableDebugger: true,
  healthFailureURL: null,
  keepAlive: false,
  maxCPU: 100,
  maxChromeRefreshRetries: 1,
  maxConcurrentSessions: 2,
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

const shutdown = (instances) => {
  return Promise.all(instances.map((instance) => instance.close()));
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

  afterAll(async () => {
    sleep(10).then(() => process.exit());
  });

  describe('WebSockets', () => {
    it('runs requests concurrently', async () => {
      const browserless = new BrowserlessServer(defaultParams);
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
      expect(browserless.currentStat.queued).toEqual(0);

      return shutdown([ browserless ]);
    });

    it('fails requests', async () => {
      const browserless = new BrowserlessServer({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` })
        .then(throws)
        .catch((error) => {
          expect(error.message).toEqual(`connect ECONNREFUSED 127.0.0.1:${defaultParams.port}`);
        });

      return shutdown([ browserless ]);
    });

    it.skip('runs uploaded code');

    it.skip('closes chrome when complete');
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
