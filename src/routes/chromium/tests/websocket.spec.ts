import {
  Browserless,
  BrowserlessSessionJSON,
  Config,
  Metrics,
  exists,
  fetchJson,
  sleep,
} from '@browserless.io/browserless';
import { chromium } from 'playwright-core';
import { deleteAsync } from 'del';
import { expect } from 'chai';
import puppeteer from 'puppeteer-core';

describe('Chromium WebSocket API', function () {
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

  it('runs chromium websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    await browser.close();
  });

  it('runs chromium Playwright-CDP requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000/chromium?token=browserless`,
    );

    await browser.close();
  });

  it('runs multiple websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    await Promise.all([browser.disconnect(), browserTwo.disconnect()]);
  });

  it('does not close browsers when multiple clients are connected', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    // Single session
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });
    await sleep(100);
    const [session] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(session.numbConnected).to.equal(1);

    // Two sessions
    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/devtools/browser/${session.browserId}?token=browserless`,
    });
    await sleep(100);
    const [twoSessions] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(twoSessions.numbConnected).to.equal(2);

    // Back to a single session
    await browser.disconnect();
    await sleep(100);
    const [oneSession] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(oneSession.numbConnected).to.equal(1);

    // No sessions connected
    await browserTwo.disconnect();
    await sleep(100);
    const sessionsFinal = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    expect(sessionsFinal).to.have.length(0);
  });

  it('disconnects all clients when the timeout is reached', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setTimeout(1000);
    config.setConcurrent(2);
    const metrics = new Metrics();
    await start({ config, metrics });
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });
    const [session] = (await fetchJson(
      'http://localhost:3000/sessions?token=browserless',
    )) as BrowserlessSessionJSON[];
    const browserTwo = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/devtools/browser/${session.browserId}?token=browserless`,
    });
    await sleep(3000);
    expect(metrics.get().successful).to.equal(0);
    expect(metrics.get().timedout).to.equal(2);
    expect(browser.connected).to.be.false;
    expect(browserTwo.connected).to.be.false;
  });

  it('rejects websocket requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=bad`,
      })
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('rejects file protocol requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const didError = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
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
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const args = {
      ignoreDefaultArgs: true,
    };

    const success = await puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${JSON.stringify(
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
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());
    expect(await exists(userDataDir)).to.be.true;

    await browser.disconnect();
    await sleep(1000);

    expect(await exists(userDataDir)).to.be.false;
  });

  it('allows specified user-data-dirs', async () => {
    const dataDir = '/tmp/data-dir';
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const launch = JSON.stringify({
      args: [`--user-data-dir=${dataDir}`],
    });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
    });

    const [{ userDataDir }] = await fetch(
      'http://localhost:3000/sessions?token=browserless',
    ).then((r) => r.json());

    expect(await exists(userDataDir)).to.be.true;
    expect(userDataDir).to.equal(dataDir);

    await browser.disconnect();
    await sleep(1000);

    expect(await exists(userDataDir)).to.be.true;
  });

  it('creates user-data-dirs with userDataDir options', async () => {
    const dataDirLocation = '/tmp/browserless-test-dir';
    const launch = JSON.stringify({
      userDataDir: dataDirLocation,
    });
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
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
      args: [`--user-data-dir=${dataDirLocation}`],
    });
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless&launch=${launch}`,
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
    config.setToken('browserless');
    config.setTimeout(-1); // No timeout
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium?timeout=1000&token=browserless`,
    });
    expect(browser.connected).to.be.true;
    await sleep(1200);
    expect(metrics.get().timedout).to.equal(1);
    expect(metrics.get().successful).to.equal(0);
    expect(browser.connected).to.be.false;
  });

  it('allows the file-chooser', async () =>
    new Promise(async (done) => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const job = async () => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
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
    config.setToken('browserless');
    config.setConcurrent(1);
    const metrics = new Metrics();
    await start({ config, metrics });

    const job = async () => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
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
    config.setToken('browserless');
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    return puppeteer
      .connect({
        browserWSEndpoint: `ws://localhost:3000/chromium?token=browserless`,
      })
      .catch((error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(1);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain.oneOf([`400`, `429`]);
      });
  });

  it('fails requests without tokens', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    return puppeteer
      .connect({ browserWSEndpoint: `ws://localhost:3000/chromium` })
      .catch((error: Error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(0);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain(`401`);
      });
  });

  it('runs playwright', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connect(
      `ws://localhost:3000/chromium/playwright?token=browserless`,
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
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const browser = await chromium.connectOverCDP(
      `ws://localhost:3000/chromium?token=browserless`,
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
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await chromium
      .connect(`ws://localhost:3000/chromium/playwright`)
      .catch((e) => {
        const results = metrics.get();
        expect(e.message).to.include('Bad or missing authentication');
        expect(results.timedout).to.equal(0);
        expect(results.successful).to.equal(0);
        expect(results.unauthorized).to.equal(1);
        expect(results.queued).to.equal(0);
      });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();

    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://localhost:3000/chromium`,
    });

    await browser.disconnect();
  });
});
