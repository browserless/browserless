import { expect } from 'chai';
import { webkit } from 'playwright-core';

import { Browserless } from '../../../browserless.js';
import { Config } from '../../../config.js';
import { Metrics } from '../../../metrics.js';

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

  it('runs webkit websocket requests', async () => {
    await start();

    const browser = await webkit.connect(
      `ws://localhost:3000/playwright/webkit?token=browserless`,
    );

    await browser.close();
  });

  it('rejects websocket requests', async () => {
    await start();

    const didError = await webkit
      .connect(`ws://localhost:3000/playwright/webkit?token=browserless`)
      .then(() => false)
      .catch(() => true);

    expect(didError).to.be.true;
  });
});
