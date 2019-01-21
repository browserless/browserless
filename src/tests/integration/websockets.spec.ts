import * as puppeteer from 'puppeteer';

import { BrowserlessServer } from '../../browserless';
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
    await browserless.kill();

    return killChrome();
  });

  it.skip('runs concurrently', async (done) => {
    const params = defaultParams();
    const browserless = await start({
      ...params,
      maxConcurrentSessions: 2,
    });

    await browserless.startServer();

    const job = async () => {
      return new Promise(async (resolve) => {
        const browser = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:${params.port}`,
        });

        browser.on('disconnected', resolve);
        browser.close();
      });
    };

    browserless.queue.on('end', () => {
      expect(browserless.currentStat.successful).toEqual(2);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(0);
      done();
    });

    job();
    job();
  });

  it('runs with no timeouts', async (done) => {
    const params = defaultParams();
    const browserless = await start({
      ...params,
      connectionTimeout: -1,
    });
    await browserless.startServer();

    const job = async () => {
      return new Promise(async (resolve) => {
        const browser: any = await puppeteer.connect({
          browserWSEndpoint: `ws://localhost:${params.port}`,
        });

        browser.on('disconnected', resolve);

        browser.close();
      });
    };

    browserless.queue.on('end', () => {
      expect(browserless.currentStat.timedout).toEqual(0);
      expect(browserless.currentStat.successful).toEqual(1);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(0);
      done();
    });

    job();
  });

  it('queues requests', async (done) => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 1,
    });

    await browserless.startServer();

    const job = async () => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://localhost:${params.port}`,
      });

      browser.close();
    };

    browserless.queue.on('end', () => {
      expect(browserless.currentStat.successful).toEqual(2);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(1);
      done();
    });

    job();
    job();
  });

  it('fails requests', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      maxConcurrentSessions: 0,
      maxQueueLength: 0,
    });

    await browserless.startServer();

    return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toEqual(`socket hang up`);
      });
  });

  it('fails requests in demo mode', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      demoMode: true,
    });

    await browserless.startServer();

    return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toEqual(`socket hang up`);
      });
  });

  it('fails requests without tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abc',
    });

    await browserless.startServer();

    return puppeteer.connect({ browserWSEndpoint: `ws://localhost:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toEqual(`socket hang up`);
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
      browserWSEndpoint: `ws://localhost:${params.port}`,
    });

    await browser.close();
    const processes = await getChromeProcesses();

    await sleep(100);

    expect(processes.stdout).not.toContain('.local-chromium');
  });
});
