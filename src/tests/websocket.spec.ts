import { expect } from 'chai';
import puppeteer from 'puppeteer-core';

import { Browserless } from '../browserless.js';
import { Config } from '../config.js';
import { Metrics } from '../metrics.js';
import { exists, sleep } from '../utils.js';

describe('WebSocket API', function () {

  // Server shutdown can take a few seconds
  // and so can these tests :/
  this.timeout(5000);

  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    config.setToken('browserless');
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('runs websocket requests', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless`,
    });

    await browser.disconnect();
  });

  it('runs multiple websocket requests', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless`,
    });

    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless`,
    });

    await Promise.all([browser.disconnect(), browserTwo.disconnect()]);
  });

  it('rejects websocket requests', async () => {
    await start();

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://127.0.0.1:3000?token=bad`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('rejects file protocol requests', async () => {
    await start();

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless`,
      })
      .then(async (b) => {
        const page = await b.newPage();
        await page.goto('file:///etc/passwd');
        await page.content();
        await b.disconnect();
        return false;
      })
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('runs with ignored arguments', async () => {
    await start();
    const args = {
      ignoreDefaultArgs: true,
    };

    const success = await puppeteer
      .connect({
        browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless&launch=${JSON.stringify(
          args,
        )}`,
      })
      .then(async (b) => {
        const page = await b.newPage();
        await page.close();
        await b.disconnect();
        return true;
      })
      .catch(() => false);

    expect(success).to.be.true;
  });

  it('deletes user-data-dirs when not specified', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:3000?token=browserless`,
    });

    const [{ userDataDir }] = await fetch(
      'http://127.0.01:3000/sessions?token=browserless',
    ).then((r) => r.json());
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(500);

    expect(await exists(userDataDir)).to.be.false;
  });

  it('creates user-data-dirs with CLI flags', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();
      const userDataDir = '/tmp/browserless-123';

      expect(await exists(userDataDir)).to.be.false;

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?--user-data-dir=${userDataDir}`,
          });

          expect(await exists(userDataDir)).to.be.true;
          browser.once('disconnected', resolve);
          browser.disconnect();
          // @ts-ignore
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

      expect(await exists(userDataDir)).to.be.false;

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await puppeteer.connect({
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?userDataDir=${userDataDir}`,
          });
          expect(await exists(userDataDir)).to.be.true;
          browser.once('disconnected', resolve);
          browser.disconnect();
          // @ts-ignore
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
        expect(browserless.currentStat.timedout).to.equal(0);
        expect(browserless.currentStat.successful).to.equal(1);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);

        // browserless binds to these two events
        // for graceful closing but puppeteer shouldn't
        expect(process.listeners('SIGINT').length).to.equal(1);
        expect(process.listeners('SIGTERM').length).to.equal(1);

        expect(process.listeners('exit').length).to.equal(0);
        expect(process.listeners('SIGHUP').length).to.equal(0);
        done();
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
            browserWSEndpoint: `ws://127.0.0.1:${params.port}?timeout=5000`,
          })
          .catch((error) => {
            expect(error.message).to.contain('socket hang up');
          });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).to.equal(1);
        expect(browserless.currentStat.successful).to.equal(0);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        done();
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
          expect(fileChooser).to.not.be.undefined;
          expect(fileChooser).to.not.be.null;
        }
        browser.disconnect();
        done();
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
        expect(browserless.currentStat.successful).to.equal(2);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(1);
        done();
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
        expect(browserless.currentStat.successful).to.equal(0);
        expect(browserless.currentStat.rejected).to.equal(1);
        expect(browserless.currentStat.queued).to.equal(0);
        expect(error.message).to.contain.oneOf([`400`, `429`]);
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
        expect(browserless.currentStat.successful).to.equal(0);
        expect(browserless.currentStat.rejected).to.equal(1);
        expect(browserless.currentStat.queued).to.equal(0);
        expect(error.message).to.contain(`socket hang up`);
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
        expect(browserless.currentStat.successful).to.equal(0);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        expect(error.message).to.contain(`403`);
      });
  });

  it('runs playwright', async () =>
    new Promise(async (done) => {
      const params = defaultParams();
      const browserless = await start(params);
      await browserless.startServer();

      const job = async () => {
        return new Promise(async (resolve) => {
          const browser: any = await chromium.connect(
            `ws://127.0.0.1:${params.port}/playwright`,
          );

          browser.once('disconnected', resolve);

          browser.close();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).to.equal(0);
        expect(browserless.currentStat.successful).to.equal(1);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        done();
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
          const browser: any = await chromium.connect(
            `ws://127.0.0.1:${params.port}/playwright?--user-data-dir=/tmp&headless=false`,
          );

          browser.once('disconnected', resolve);

          browser.close();
        });
      };

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).to.equal(0);
        expect(browserless.currentStat.successful).to.equal(1);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        done();
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
      .connect(`ws://127.0.0.1:${params.port}/playwright`)
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).to.equal(0);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        expect(error.message).to.contain(`403`);
      });
  });

  it('versions playwright dynamically', async () =>
    new Promise(async (done) => {
      const { playwrightVersions } = require('../../../package.json');
      const params = defaultParams();
      const browserless = await start(params);
      const pwKeys = Object.keys(playwrightVersions);

      await browserless.startServer();

      for (const version of pwKeys) {
        const playwright = await getPlaywright(version);

        const job = async () => {
          return new Promise<void>(async (resolve) => {
            const browser: any = await playwright.connect({
              wsEndpoint: `ws://127.0.0.1:${params.port}/playwright`,
            });

            browser.close();
            resolve();
          });
        };

        await job();
      }

      browserless.queue.on('end', () => {
        expect(browserless.currentStat.timedout).to.equal(0);
        expect(browserless.currentStat.successful).to.equal(pwKeys.length);
        expect(browserless.currentStat.rejected).to.equal(0);
        expect(browserless.currentStat.queued).to.equal(0);
        done();
      });
    }));

});
