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
});
