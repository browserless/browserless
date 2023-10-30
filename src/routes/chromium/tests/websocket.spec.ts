import { expect } from 'chai';
import { deleteAsync } from 'del';
import { chromium } from 'playwright-core';
import puppeteer from 'puppeteer-core';

import { Browserless } from '../../../browserless.js';
import { Config } from '../../../config.js';
import { Metrics } from '../../../metrics.js';
import { exists, sleep } from '../../../utils.js';

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

  it('runs chromium websocket requests', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });

    await browser.disconnect();
  });

  it('runs chromium CDP requests', async () => {
    await start();

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000?token=browserless`,
    );

    await browser.close();
  });

  it('runs chromium websocket requests', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });

    await browser.disconnect();
  });

  it('runs multiple websocket requests', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });

    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });

    await Promise.all([browser.disconnect(), browserTwo.disconnect()]);
  });

  it('rejects websocket requests', async () => {
    await start();

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000?token=bad`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('rejects file protocol requests', async () => {
    await start();

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000?token=browserless`,
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
        browserWSEndpoint: `ws://localhost:3000?token=browserless&launch=${JSON.stringify(
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
      browserWSEndpoint: `ws://localhost:3000?token=browserless`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(1000);

    expect(await exists(userDataDir)).to.be.false;
  });

  it('creates user-data-dirs with userDataDir options', async () => {
    const dataDirLocation = '/tmp/browserless-test-dir';
    const launch = JSON.stringify({
      userDataDir: dataDirLocation,
    });
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(userDataDir === dataDirLocation).to.be.true;
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(500);

    expect(await exists(userDataDir)).to.be.true;
    await deleteAsync(userDataDir, { force: true });
  });

  it('creates user-data-dirs with CLI flags', async () => {
    const dataDirLocation = '/tmp/browserless-test-dir';
    const launch = JSON.stringify({
      args: [`--user-data-dir==${dataDirLocation}`],
    });
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(userDataDir === dataDirLocation).to.be.true;
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(500);

    expect(await exists(userDataDir)).to.be.true;
    await deleteAsync(userDataDir, { force: true });
  });

  it('runs with job-based timeouts', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setTimeout(-1); // No timeout
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000?timeout=500&token=browserless`,
    });

    await sleep(750);
    browser.disconnect();
    expect(metrics.get().timedout).to.equal(1);
    expect(metrics.get().successful).to.equal(0);
  });

  it('allows the file-chooser', async () =>
    new Promise(async (done) => {
      await start();
      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:3000?token=browserless`,
        });

        const page = await browser.newPage();

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

  it('queues requests', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setConcurrent(1);
    await start({ config, metrics });

    const job = async () => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:3000?token=browserless`,
      });
      await sleep(100);

      return browser.disconnect();
    };

    await Promise.all([job(), job()]);

    await sleep(100);

    const results = metrics.get();
    expect(results.successful).to.equal(2);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(1);
  });

  it('fails requests', async () => {
    const config = new Config();
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    return puppeteer
      .connect({ browserWSEndpoint: `ws://localhost:3000?token=browserless` })
      .catch((error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(1);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain.oneOf([`400`, `429`]);
      });
  });

  it('fails requests without tokens', async () => {
    const metrics = new Metrics();
    await start({ metrics });

    return puppeteer
      .connect({ browserWSEndpoint: `ws://localhost:3000` })
      .catch((error: Error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(0);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain(`401`);
      });
  });

  it('runs playwright', async () => {
    const metrics = new Metrics();
    await start({ metrics });

    const browser = await chromium.connect(
      `ws://localhost:3000/playwright/chromium?token=browserless`,
    );

    await browser.close();
    await sleep(100);

    const results = metrics.get();
    expect(results.timedout).to.equal(0);
    expect(results.successful).to.equal(1);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(0);
  });

  it('runs playwright over CDP', async () => {
    const metrics = new Metrics();
    await start({ metrics });

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000?token=browserless`,
    );

    await browser.close();
    await sleep(100);

    const results = metrics.get();
    expect(results.timedout).to.equal(0);
    expect(results.successful).to.equal(1);
    expect(results.rejected).to.equal(0);
    expect(results.queued).to.equal(0);
  });

  it('rejects playwright without tokens', async () => {
    const metrics = new Metrics();
    await start({ metrics });

    await chromium
      .connect(`ws://localhost:3000/playwright/chromium`)
      .catch((e) => {
        const results = metrics.get();
        expect(e.message).to.include('Bad or missing authentication');
        expect(results.timedout).to.equal(0);
        expect(results.successful).to.equal(0);
        expect(results.unauthorized).to.equal(1);
        expect(results.queued).to.equal(0);
      });
  });
});
