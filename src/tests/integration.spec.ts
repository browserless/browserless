import { exec as execNode } from 'child_process';
import * as puppeteer from 'puppeteer';
import * as util from 'util';
import { BrowserlessServer } from '../browserless-server';

const fetch = require('node-fetch');

const exec = util.promisify(execNode);
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

const getChromeProcesses = () => {
  return exec(`ps -ef | grep chromium`);
};

describe('Browserless Chrome', () => {
  let browserless: BrowserlessServer = null;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(() => {
    browserless.close();
    browserless = null;
  });

  describe('WebSockets', () => {
    it('runs concurrently', async () => {
      const browserless = await start({
        ...defaultParams,
        maxConcurrentSessions: 2,
      });
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://localhost:${defaultParams.port}`,
          });

          browser.on('disconnected', resolve);

          browser.close();
        });
      };

      await Promise.all([
        job(),
        job(),
      ]);

      await sleep(20);

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

      await sleep(10);

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

    // TODO: This isn't closing Chrome properly need to find out why
    it.skip('pre-boots chrome to match concurrency', async () => {
      const conncurent = 1;
      const browserless: any = start({
        ...defaultParams,
        maxConcurrentSessions: conncurent,
        prebootChrome: true,
      });

      await browserless.startServer();

      expect(browserless.chromeService.chromeSwarm).toHaveLength(conncurent);
    });

    it('closes chrome when the session is closed', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 2,
      });
      await browserless.startServer();

      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:${defaultParams.port}`,
      });

      await browser.close();
      const processes = await getChromeProcesses();

      await sleep(10);

      expect(processes.stdout).not.toContain('.local-chromium');
    });
  });

  describe('HTTP', () => {
    it('allows requests to /json/version', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/json/version`)
        .then((res) => res.json())
        .then((version) => {
          expect(Object.keys(version)).toMatchSnapshot();
        });
    });

    it('allows requests to /introspection', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/introspection`)
        .then((res) => res.json())
        .then((introspection) => {
          expect(introspection);
        });
    });

    it('allows requests to /json/protocol', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/json/protocol`)
        .then((res) => res.json())
        .then((protocol) => {
          expect(Object.keys(protocol)).toMatchSnapshot();
        });
    });

    it('allows requests to /metrics', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/metrics`)
        .then((res) => res.json())
        .then((metrics) => {
          expect(metrics).toMatchSnapshot();
        });
    });

    it('allows requests to /config', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/config`)
        .then((res) => res.json())
        .then((config) => {
          expect(config).toMatchSnapshot();
        });
    });

    it('allows requests to /pressure', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      return fetch(`http://localhost:${defaultParams.port}/pressure`)
        .then((res) => res.json())
        .then((res) => {
          const { pressure } = res;
          expect(Object.keys(pressure)).toMatchSnapshot();
        });
    });

    describe('/function', () => {
      it('allows running functions', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          code: `module.exports = ({ page }) => {
            return Promise.resolve({
              data: 'ok',
              type: 'application/text',
            });
          }`,
          context: {},
        };

        return fetch(`http://localhost:${defaultParams.port}/function`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => res.text())
          .then((res) => {
            expect(res).toBe('ok');
          });
      });

      it('allows custom response-types', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          code: `module.exports = ({ page }) => {
            return Promise.resolve({
              data: {
                status: 'ok',
              },
              type: 'application/json',
            });
          }`,
          context: {},
        };

        return fetch(`http://localhost:${defaultParams.port}/function`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => res.json())
          .then((res) => {
            expect(res.status).toBe('ok');
          });
      });

      it('catches errors', async () => {
        const error = 'Bad Request!';
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          code: `module.exports = async ({ page }) => {
            throw new Error("${error}");
          }`,
          context: {},
        };

        return fetch(`http://localhost:${defaultParams.port}/function`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toEqual(500);
            expect(res.ok).toEqual(false);
            return res.text();
          })
          .then((message) => {
            expect(message).toEqual(error);
          });
      });
    });

    it.skip('allows requests to /screenshot', () => {});
    it.skip('allows requests to /content', () => {});
    it.skip('allows requests to /pdf', () => {});
  });
});
