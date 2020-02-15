import * as puppeteer from 'puppeteer';

import { BrowserlessServer } from '../../browserless';
import { IBrowserlessOptions } from '../../types';
import { sleep } from '../../utils';

import {
  defaultParams,
  getChromeProcesses,
  killChrome,
  throws,
} from './utils';

describe('Browserless Chrome WebSockets', () => {
  let browserless: BrowserlessServer;
  const start = (args: IBrowserlessOptions) => browserless = new BrowserlessServer(args);

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
          browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
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
          browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
        });

        browser.once('disconnected', resolve);

        browser.disconnect();
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

  it('runs with job-based timeouts', async (done) => {
    const params = defaultParams();
    const browserless = await start({
      ...params,
      connectionTimeout: -1,
    });
    await browserless.startServer();

    const job = async () => {
      await puppeteer.connect({
        browserWSEndpoint: `ws://127.0.0.1:${params.port}?timeout=100`,
      }).catch((error) => {
        expect(error.message).toContain('socket hang up');
      });
    };

    browserless.queue.on('end', () => {
      expect(browserless.currentStat.timedout).toEqual(1);
      expect(browserless.currentStat.successful).toEqual(0);
      expect(browserless.currentStat.rejected).toEqual(0);
      expect(browserless.currentStat.queued).toEqual(0);
      done();
    });

    job();
  });

  it('allows the file-chooser', async (done) => {
    const params = defaultParams();
    const browserless = await start(params);
    await browserless.startServer();

    const job = async () => {
      const browser = await puppeteer.connect({
        browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
      });
      const [ page ] = await browser.pages();

      await page.setContent(`<div class="output" style="height: 62%;"><label for="avatar">Choose a profile picture:</label>
        <input type="file" id="avatar" name="avatar" accept="image/png, image/jpeg">
      </div>`);

      if (page.waitForFileChooser) {
        const [fileChooser] = await Promise.all([
          page.waitForFileChooser(),
          page.click('#avatar'),
        ]);
        expect(fileChooser).toEqual(expect.anything());
      }
      browser.disconnect();
      done();
    };

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
        browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
      });

      browser.disconnect();
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

    return puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(1);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`429`);
      });
  });

  it('fails requests in demo mode', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      demoMode: true,
    });

    await browserless.startServer();

    return puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`403`);
      });
  });

  it('fails requests without tokens', async () => {
    const params = defaultParams();
    const browserless = start({
      ...params,
      token: 'abc',
    });

    await browserless.startServer();

    return puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${params.port}` })
      .then(throws)
      .catch((error) => {
        expect(browserless.currentStat.successful).toEqual(0);
        expect(browserless.currentStat.rejected).toEqual(0);
        expect(browserless.currentStat.queued).toEqual(0);
        expect(error.message).toContain(`403`);
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
      browserWSEndpoint: `ws://127.0.0.1:${params.port}`,
    });

    await browser.disconnect();
    const processes = await getChromeProcesses();

    await sleep(100);

    expect(processes.stdout).not.toContain('.local-chromium');
  });
});
