import { expect } from 'chai';

import { BrowserlessServer } from '../../browserless';
import { IBrowserlessOptions } from '../../types.d';
import { sleep } from '../../utils';

import {
  defaultParams,
  getChromeProcesses,
  throws,
  webdriverOpts,
} from './utils';

const webdriver = require('selenium-webdriver');

describe('Browserless Chrome Webdriver', () => {
  let browserless: BrowserlessServer;
  const start = (args: IBrowserlessOptions) =>
    (browserless = new BrowserlessServer(args));

  afterEach(async () => {
    sleep(1000);
    await browserless.kill();
  });

  it('runs concurrently', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 2,
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await Promise.all([run(), run()]);
    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(2);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('handles driver close calls', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start(params);

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.close();
    }

    await run();
    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('runs lengthy sessions', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 1,
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.manage().getCookies();
      await driver.manage().getCookies();
      await driver.manage().getCookies();
      await driver.manage().getCookies();
      await driver.manage().getCookies();
      await driver.manage().getCookies();
      await driver.quit();
    }

    await Promise.all([run()]);
    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('works with no timeouts', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      connectionTimeout: -1,
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await run();
    await sleep(50);

    expect(browserless.currentStat.timedout).to.equal(0);
    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('works with job-based timeouts', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      connectionTimeout: -1,
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);
    chromeCapabilities.set('browserless:timeout', 10);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await run();
    await sleep(1000);

    expect(browserless.currentStat.timedout).to.equal(1);
    expect(browserless.currentStat.successful).to.equal(0);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('authorizes with tokens', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      token: 'abcd',
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://abcd@127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await run();
    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('authorizes with webdriver-backed tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abcd',
    });

    await browserless.startServer();

    async function run(capabilities: any) {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(capabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    {
      const chromeCapabilities = webdriver.Capabilities.chrome();
      chromeCapabilities.set('goog:chromeOptions', webdriverOpts);
      chromeCapabilities.set('browserless:token', 'abcd');
      await run(chromeCapabilities);
    }

    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
  });

  it('queues sessions', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start(params);

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    async function run() {
      const driver = new webdriver.Builder()
        .forBrowser('chrome')
        .withCapabilities(chromeCapabilities)
        .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
        .build();

      await driver.get('https://example.com');
      await driver.quit();
    }

    await Promise.all([run(), run()]);
    await sleep();

    expect(browserless.currentStat.successful).to.equal(2);
    expect(browserless.currentStat.queued).to.equal(1);
  });

  it('fails requests', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 0,
      maxQueueLength: 0,
    });

    await browserless.startServer();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    return new webdriver.Builder()
      .forBrowser('chrome')
      .withCapabilities(chromeCapabilities)
      .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
      .build()
      .then(throws)
      .catch((error: Error) => {
        expect(error.message).to.equal(
          'Unable to parse new session response: ',
        );
      });
  });

  it('fails requests without tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abc',
    });

    await browserless.startServer();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    return new webdriver.Builder()
      .forBrowser('chrome')
      .withCapabilities(chromeCapabilities)
      .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
      .build()
      .then(throws)
      .catch((error: Error) => {
        expect(error.message).to.equal('Unauthorized');
      });
  });

  it.skip('closes chrome when the session is closed', async () => {
    const params = defaultParams();
    const chromeCapabilities = webdriver.Capabilities.chrome();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 2,
    });

    await browserless.startServer();
    chromeCapabilities.set('goog:chromeOptions', webdriverOpts);

    const driver = new webdriver.Builder()
      .forBrowser('chrome')
      .withCapabilities(chromeCapabilities)
      .usingServer(`http://127.0.0.1:${params.port}/webdriver`)
      .build();

    await driver.get('https://example.com');
    await driver.quit();

    await sleep(50);

    expect(browserless.currentStat.successful).to.equal(1);
    expect(browserless.currentStat.rejected).to.equal(0);
    expect(browserless.currentStat.queued).to.equal(0);
    const processes = await getChromeProcesses();

    await sleep(50);

    expect(processes.stdout).to.not.contain('.local-chromium');
  });
});
