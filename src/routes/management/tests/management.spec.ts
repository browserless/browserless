import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { CdpBrowser } from 'puppeteer-core/lib/esm/puppeteer';
import { expect } from 'chai';
import puppeteer from 'puppeteer-core';

describe('Management APIs', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    config.setToken('6R0W53R135510');
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('allows requests to /config', async () => {
    await start();

    await fetch('http://localhost:3000/config?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'application/json; charset=UTF-8',
        );
        expect(res.status).to.equal(200);
      },
    );
  });

  it('allows requests to /metrics', async () => {
    await start();

    await fetch('http://localhost:3000/metrics?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'application/json; charset=UTF-8',
        );
        expect(res.status).to.equal(200);
      },
    );
  });

  it('allows requests to /metrics/total', async () => {
    await start();

    await fetch('http://localhost:3000/metrics/total?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'application/json; charset=UTF-8',
        );
        expect(res.status).to.equal(200);
      },
    );
  });

  it('allows requests to /pressure', async () => {
    await start();

    await fetch('http://localhost:3000/pressure?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'application/json; charset=UTF-8',
        );
        expect(res.status).to.equal(200);
      },
    );
  });

  it('allows requests to /sessions', async () => {
    await start();

    await fetch('http://localhost:3000/sessions?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'application/json; charset=UTF-8',
        );
        expect(res.status).to.equal(200);
      },
    );
  });

  it('filters sessions by trackingId', async () => {
    await start();
    const browsers = (await Promise.all(
      [1, 2, 3, 4, 5].map(
        (i) =>
          new Promise(async (resolve) => {
            const browser = await puppeteer.connect({
              browserWSEndpoint: `ws://localhost:3000/chromium?token=6R0W53R135510&trackingId=tracker${i}`,
            });

            resolve(browser);
          }),
      ),
    )) as CdpBrowser[];

    await fetch(
      'http://localhost:3000/sessions?token=6R0W53R135510&trackingId=tracker1',
    ).then(async (res) => {
      const sessions = await res.json();
      expect(sessions.length).to.equal(2); // 2 objects, one for the Browser, one for the Page
      expect(res.headers.get('content-type')).to.equal(
        'application/json; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });

    browsers.forEach((b) => b.close());
  });

  it('allows requests to /active', async () => {
    await start();

    await fetch('http://localhost:3000/active?token=6R0W53R135510').then(
      async (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'text/plain; charset=UTF-8',
        );
        expect(res.status).to.equal(204);
      },
    );
  });

  it('allows HEAD requests to /active', async () => {
    await start();

    await fetch('http://localhost:3000/active?token=6R0W53R135510', {
      method: 'HEAD',
    }).then(async (res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/plain; charset=UTF-8',
      );
      expect(res.status).to.equal(204);
    });
  });
});
