import { exec as execNode } from 'child_process';
import * as puppeteer from 'puppeteer';
import * as util from 'util';
import { getChromePath } from '../chrome-helper';

import { BrowserlessServer } from '../browserless-server';
import { IBrowserlessOptions } from '../models/options.interface';
import { sleep } from '../utils';

const fetch = require('node-fetch');

const exec = util.promisify(execNode);
const defaultParams: IBrowserlessOptions = {
  chromeBinaryPath: getChromePath(),
  chromeRefreshTime: 0,
  connectionTimeout: 2000,
  demoMode: false,
  enableCors: false,
  enableDebugger: true,
  functionBuiltIns: [],
  functionExternals: [],
  healthFailureURL: null,
  host: '',
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

const throws = () => {
  throw new Error(`Should have thrown`);
};

const getChromeProcesses = () => {
  return exec(`ps -ef | grep local-chromium`);
};

const killChrome = () => {
  return exec(`pkill -f local-chromium`)
    .catch(() => {});
};

describe('Browserless Chrome', () => {
  let browserless: BrowserlessServer = null;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(async () => {
    browserless.close();
    browserless = null;

    return killChrome();
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

      await sleep(50);

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
          expect(Object.keys(config)).toMatchSnapshot();
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

      it('allows running detached functions', async () => {
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
          detached: true,
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
            expect(res).toHaveProperty('id');
          });
      });

      it('allows functions that require node built-ins', async () => {
        const browserless = start({
          ...defaultParams,
          functionBuiltIns: ['util'],
        });
        await browserless.startServer();

        const body = {
          code: `
          const util = require('util');
          module.exports = ({ page }) => {
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

      it('allows functions that require external modules', async () => {
        const browserless = start({
          ...defaultParams,
          functionExternals: ['node-fetch'],
        });
        await browserless.startServer();

        const body = {
          code: `
          const fetch = require('node-fetch');
          module.exports = ({ page }) => {
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

      it('denies functions that require node built-ins', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          code: `
          const util = require('request');
          module.exports = ({ page }) => {
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
            expect(res).toContain(`The module 'request' is not whitelisted in VM.`);
          });
      });

      it('denies functions that require external modules', async () => {
        const browserless = start({
          ...defaultParams,
          functionExternals: [],
        });
        await browserless.startServer();

        const body = {
          code: `
          const fetch = require('node-fetch');
          module.exports = ({ page }) => {
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
            expect(res).toContain(`The module 'node-fetch' is not whitelisted in VM`);
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

      it('times-out requests', async () => {
        const browserless = start({
          ...defaultParams,
          connectionTimeout: 1,
        });
        await browserless.startServer();

        const body = {
          code: `module.exports = ({ page }) => {
            return new Promise(() => {});
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
            expect(res.status).toEqual(408);
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

      it('catches errors in browserless', async () => {
        const chromeBinaryPath = '/im/not/here';
        const browserless = start({
          ...defaultParams,
          chromeBinaryPath,
        });

        await browserless.startServer();

        const body = {
          code: `module.exports = async ({ page }) => {
            return {
              data: 'cool!',
            };
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
            expect(message).toContain(`Failed to launch chrome! spawn ${chromeBinaryPath} ENOENT`);
          });
      });
    });

    describe('/screenshot', () => {
      it('allows requests', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.headers.get('content-type')).toEqual('image/png');
            expect(res.status).toBe(200);
          });
      });

      it('times out requests', async () => {
        const browserless = start({
          ...defaultParams,
          connectionTimeout: 1,
        });
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(408);
          });
      });

      it('rejects requests', async () => {
        const browserless = start({
          ...defaultParams,
          maxConcurrentSessions: 0,
          maxQueueLength: 0,
        });

        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(429);
          });
      });

      it('allows custom goto options', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          gotoOptions: {
            waitUntil: `networkidle2`,
          },
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });

      it('allows for injecting HTML', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          html: '<h1>Hello!</h1>',
        };

        return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });
    });

    describe('/pdf', () => {
      it('allows requests', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.headers.get('content-type')).toEqual('application/pdf');
            expect(res.status).toBe(200);
          });
      });

      it('times out requests', async () => {
        const browserless = start({
          ...defaultParams,
          connectionTimeout: 1,
        });
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(408);
          });
      });

      it('rejects requests', async () => {
        const browserless = start({
          ...defaultParams,
          maxConcurrentSessions: 0,
          maxQueueLength: 0,
        });

        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(429);
          });
      });

      it('allows custom goto options', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          gotoOptions: {
            waitUntil: `networkidle2`,
          },
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });

      it('allows for injecting HTML', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          html: '<h1>Hello!</h1>',
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });

      it('allows for PDF options', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          html: '<h1>Hello!</h1>',
          options: {
            landscape: true,
          },
        };

        return fetch(`http://localhost:${defaultParams.port}/pdf`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });
    });

    describe('/content', () => {
      it('allows requests', async () => {
        const browserless = start(defaultParams);
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/content`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.headers.get('content-type')).toEqual('text/html; charset=utf-8');
            expect(res.status).toBe(200);
          });
      });

      it('times out requests', async () => {
        const browserless = start({
          ...defaultParams,
          connectionTimeout: 1,
        });
        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/content`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(408);
          });
      });

      it('rejects requests', async () => {
        const browserless = start({
          ...defaultParams,
          maxConcurrentSessions: 0,
          maxQueueLength: 0,
        });

        await browserless.startServer();

        const body = {
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/content`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(429);
          });
      });

      it('allows custom goto options', async () => {
        const browserless = start(defaultParams);

        await browserless.startServer();

        const body = {
          gotoOptions: {
            waitUntil: `networkidle2`,
          },
          url: 'https://example.com',
        };

        return fetch(`http://localhost:${defaultParams.port}/content`, {
          body: JSON.stringify(body),
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        })
          .then((res) => {
            expect(res.status).toBe(200);
          });
      });
    });
  });
});
