import { expect } from 'chai';
import { firefox } from 'playwright-core';

import { Browserless } from '../../../browserless.js';
import { Config } from '../../../config.js';
import { Metrics } from '../../../metrics.js';
import { sleep } from '../../../utils.js';

describe('Firefox Websocket API', function () {
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

  it('runs firefox websocket requests', async () => {
    await start();

    const browser = await firefox.connect(
      `ws://localhost:3000/playwright/firefox?token=browserless`,
    );

    await browser.close();
  });

  it('rejects playwright requests', async () => {
    await start();

    const didError = await firefox
      .connect(`ws://localhost:3000/playwright/firefox?token=bad`)
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });

  it('runs with job-based timeouts', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setTimeout(-1); // No timeout
    await start({ config, metrics });

    const browser = await firefox
      .connect(
        `ws://localhost:3000/playwright/firefox?timeout=500&token=browserless`,
      )
      .catch(() => null);

    await sleep(750);
    browser && browser.close();
    expect(metrics.get().timedout).to.equal(1);
    expect(metrics.get().successful).to.equal(0);
  });

  it('queues requests', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setConcurrent(1);
    await start({ config, metrics });

    const job = async () => {
      const browser = await firefox.connect(
        `ws://localhost:3000/playwright/firefox?token=browserless`,
      );
      await sleep(100);

      return browser.close();
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

    return firefox
      .connect(`ws://localhost:3000/playwright/firefox?token=browserless`)
      .catch((error: Error) => {
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

    return firefox
      .connect(`ws://localhost:3000/playwright/firefox`)
      .catch((error: Error) => {
        const results = metrics.get();
        expect(results.successful).to.equal(0);
        expect(results.rejected).to.equal(0);
        expect(results.queued).to.equal(0);
        expect(error.message).to.contain(`401`);
      });
  });
});
