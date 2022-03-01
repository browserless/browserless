import fetch from 'node-fetch';
import { chromium } from 'playwright-core';
import puppeteer from 'puppeteer';
import rimraf from 'rimraf';

import { BrowserlessServer } from '../../browserless';
import { IBrowserlessOptions } from '../../types.d';
import { sleep, exists } from '../../utils';

import { defaultParams, getChromeProcesses, throws } from './utils';

describe('Browserless Chrome WebSockets', () => {
  let browserless: BrowserlessServer;
  const start = (args: IBrowserlessOptions) =>
    (browserless = new BrowserlessServer(args));

  afterEach(async () => {
    await browserless.kill();
  });

  it.skip('runs concurrently', async () =>
    new Promise(async (r) => {
      const params = defaultParams();
      const browserless = await start({
        ...params,
        maxConcurrentSessions: 2,
      });

      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
          });

          browser.on('disconnected', resolve);
          browser.close();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.successful).toEqual(2);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        r(null);
      });

      job();
      job();
    }));

  it('runs with no timeouts', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start({
        ...params,
        connectionTimeout: -1,
      });
      await browserless.startServer();

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(0);
        expect(browserless.currentStat.successful).toEqual(1);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        done(null);
      });

      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
      });

      browser.disconnect();
    }));

  it('exposes sessions', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
          });
          const results = await fetch(
            `http://127.0.0.1:${params.port}/sessions`,
          );
          const [body] = await results.json();

          expect(Object.keys(body)).toMatchSnapshot();

          browser.once('disconnected', resolve);

          browser.disconnect();
        });
      };

      browserless.queue.on('end', done);

      job();
    }));

  it('rejects file requests by default', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      try {
        const browser: any = await puppeteer.connect({
          browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
        });
        const [page] = await browser.pages();
        await page.goto('file:///etc/passwd');
        done('Browser should have forcefully closed');
      } catch (e) {
        expect(e.message).toBeDefined();
        done(null);
      }
    }));

  it('filters sessions', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start({
        ...params,
        maxConcurrentSessions: 2,
      });
      await browserless.startServer();

      const trackingId = 'abc';

      const job = async () => {
        return new Promise(async () => {
          const [one, two] = await Promise.all([
            puppeteer.connect({
              browserWSEndpoint: `ws://127.0.0.1:${params.port}?trackingId=${trackingId}`,
            }),
            puppeteer.connect({
              browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
            }),
          ]);

          const results = await fetch(
            `http://127.0.0.1:${params.port}/sessions?trackingId=${trackingId}`,
          );
          const body = await results.json();

          expect(body.length).toEqual(1);

          one.disconnect();
          two.disconnect();
        });
      };

      browserless.queue.on('end', done);

      job();
    }));

  it('runs with ignored default args', async () =>
    new Promise(async (done) => {
      jest.setTimeout(10000);
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?ignoreDefaultArgs`,
          });

          browser.once('disconnected', resolve);

          browser.disconnect();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(0);
        expect(browserless.currentStat.successful).toEqual(1);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        done(null);
      });

      job();
    }));

  it('deletes tmp user-data-dirs', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
          });

          browser.once('disconnected', resolve);
          browser.disconnect();
        });
      };

      browserless.queue.on('success', async (_r, j) => {
        const tmpDir = j.browser._browserlessDataDir;
        await sleep(1000);
        expect(await exists(tmpDir)).toBe(false);
        done(null);
      });

      job();
    }));

  it('creates user-data-dirs with CLI flags', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();
      const userDataDir = '/tmp/browserless-123';

      expect(await exists(userDataDir)).toBe(false);

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?--user-data-dir=${userDataDir}`,
          });
          expect(await exists(userDataDir)).toBeTruthy();
          browser.once('disconnected', resolve);
          browser.disconnect();
          await rimraf(userDataDir, done);
        });
      };

      job();
    }));

  it('creates user-data-dirs with named flags', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();
      const userDataDir = '/tmp/browserless-123';

      expect(await exists(userDataDir)).toBe(false);

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?userDataDir=${userDataDir}`,
          });
          expect(await exists(userDataDir)).toBeTruthy();
          browser.once('disconnected', resolve);
          browser.disconnect();
          await rimraf(userDataDir, done);
        });
      };

      job();
    }));

  it('runs with no leaks', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start({
        ...params,
        connectionTimeout: -1,
      });
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
          });

          browser.once('disconnected', resolve);

          browser.disconnect();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(0);
        expect(browserless.currentStat.successful).toEqual(1);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);

        // browserless binds to these two events
        // for graceful closing but puppeteer shouldn't
        expect(process.listeners('SIGINT').length).toEqual(1);
        expect(process.listeners('SIGTERM').length).toEqual(1);

        expect(process.listeners('exit').length).toEqual(0);
        expect(process.listeners('SIGHUP').length).toEqual(0);
        done(null);
      });

      job();
    }));

  it('runs with job-based timeouts', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start({
        ...params,
        connectionTimeout: -1,
      });
      await browserless.startServer();

      const job = async () => {
        await puppeteer
          .connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?timeout=100`,
          })
          .catch((error) => {
            expect(error.message).toContain('socket hang up');
          });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(1);
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        done(null);
      });

      job();
    }));

  it('allows the file-chooser', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
        });
        const [page] = await browser.pages();

        await page.setContent(`<div class="output" style="height: 62%;"><label for="avatar">Choose a profile picture:</label>
        <input type="file" id="avatar" name="avatar" accept="image/png, image/jpeg">
      </div>`);

        if (page.waitForFileChooser) {
          const [fileChooser] = await Promise.all([
            page.waitForFileChooser(),
            page.click('#avatar'),
          ]);
          expect(fileChooser).toEqual(expect.anything());
        }
        browser.disconnect();
        done(null);
      };

      job();
    }));

  it('queues requests', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = start({
        ...params,
        maxConcurrentSessions: 1,
      });

      await browserless.startServer();

      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
        });

        browser.disconnect();
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.successful).toEqual(2);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(1);
        done(null);
      });

      job();
      job();
    }));

  it('fails requests', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 0,
      maxQueueLength: 0,
    });

    await browserless.startServer();

    return puppeteer
      .connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`429`);
      });
  });

  it('fails requests with socket destroy', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      socketBehavior: 'close',
      maxConcurrentSessions: 0,
      maxQueueLength: 0,
    });

    await browserless.startServer();

    return puppeteer
      .connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`socket hang up`);
      });
  });

  it('fails requests without tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abc',
    });

    await browserless.startServer();

    return puppeteer
      .connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`403`);
      });
  });

  it('runs playwright', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await chromium.connect({
            wsEndpoint: `ws://127.0.0.1:${params.port}/playwright`,
          });

          browser.once('disconnected', resolve);

          browser.close();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(0);
        expect(browserless.currentStat.successful).toEqual(1);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        done(null);
      });

      job();
    }));

  it(`doesn't allow playwright to do "headfull" or user-data-dirs`, async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await chromium.connect({
            wsEndpoint: `ws://127.0.0.1:${params.port}/playwright?--user-data-dir=/tmp&headless=false`,
          });

          browser.once('disconnected', resolve);

          browser.close();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).toEqual(0);
        expect(browserless.currentStat.successful).toEqual(1);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        done(null);
      });

      job();
    }));

  it('rejects playwright without tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abc',
    });

    await browserless.startServer();

    return chromium
      .connect({ wsEndpoint: `ws://127.0.0.1:${params.port}/playwright` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`403`);
      });
  });

  it.skip('closes chrome when the session is closed', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 2,
    });
    await browserless.startServer();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
    });

    await browser.disconnect();
    const processes = await getChromeProcesses();

    await sleep(100);

    expect(processes.stdout).not.toContain('.local-chromium');
  });
});
