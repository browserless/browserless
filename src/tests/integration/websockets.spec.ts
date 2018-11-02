import * as puppeteer from 'puppeteer';

import { BrowserlessServer } from '../../browserless-web-server';
import { sleep } from '../../utils';

import {
  defaultParams,
  getChromeProcesses,
  killChrome,
  throws,
} from './utils';

describe('Browserless Chrome WebSockets', () => {
  let browserless: BrowserlessServer;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(async () => {
    browserless.close();

    return killChrome();
  });

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

  it('runs with no timeouts', async () => {
    const browserless = await start({
      ...defaultParams,
      connectionTimeout: -1,
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

    await job();
    await sleep(20);

    expect(browserless.currentStat.timedout).toEqual(0);
    expect(browserless.currentStat.successful).toEqual(1);
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

  it.skip('closes chrome when the session is closed', async () => {
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

    await sleep(100);

    expect(processes.stdout).not.toContain('.local-chromium');
  });
});
