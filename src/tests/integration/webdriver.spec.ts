import { BrowserlessServer } from '../../browserless-web-server';
import { sleep } from '../../utils';

import {
  defaultParams,
  killChrome,
  webdriverOpts,
} from './utils';

const webdriver = require('selenium-webdriver');

describe('Browserless Chrome Webdriver', () => {
  let browserless: BrowserlessServer = null;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(async () => {
    browserless.close();
    browserless = null;

    return killChrome();
  });

  it('runs concurrently', async () => {
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...defaultParams,
      maxConcurrentSessions: 2,
    });

    await browserless.startServer();
    chromeCapabilities.set('chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://localhost:${defaultParams.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await Promise.all([ run(), run() ]);
    await sleep(50);

    expect(browserless.currentStat.successful).toEqual(2);
    expect(browserless.currentStat.rejected).toEqual(0);
    expect(browserless.currentStat.queued).toEqual(0);
  });

  it('queues sessions', async () => {
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start(defaultParams);

    await browserless.startServer();
    chromeCapabilities.set('chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://localhost:${defaultParams.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await Promise.all([ run(), run() ]);
    await sleep();

    expect(browserless.currentStat.successful).toEqual(2);
    expect(browserless.currentStat.queued).toEqual(1);
  });

  it.skip('fails requests', async () => {
    const browserless = start({
      ...defaultParams,
      maxConcurrentSessions: 0,
      maxQueueLength: 0,
    });

    await browserless.startServer();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    chromeCapabilities.set('chromeOptions', webdriverOpts);

    const driver = new webdriver.Builder()
      .forBrowser('chrome')
      .withCapabilities(chromeCapabilities)
      .usingServer(`http://localhost:${defaultParams.port}/webdriver`)
      .build();

    try {
      await driver.get('https://example.com');
    } catch (error) {
      return expect(error.message).toContain(`Unable to parse new session response:`);
    }
  });
});
