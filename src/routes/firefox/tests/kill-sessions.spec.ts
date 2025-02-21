import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';
import { firefox } from 'playwright-core';

describe('/kill API firefox', function () {
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

  it('Kill all sessions', async () => {
    await start();
    const browser1 = await firefox.connect(
      `ws://localhost:3000/playwright/firefox?token=browserless`,
    );
    const browser2 = await firefox.connect(
      `ws://localhost:3000/playwright/firefox?token=browserless`,
    );

    await fetch('http://localhost:3000/kill/all?token=browserless').then(
      async (res) => {
        expect(res.status).to.equal(204);
      },
    );

    let errorThrown1;
    try {
      await browser1.newPage();
    } catch (e) {
      errorThrown1 = e;
    }
    let errorThrown2;
    try {
      await browser2.newPage();
    } catch (e) {
      errorThrown2 = e;
    }
    expect((errorThrown1 as Error).message).contains('closed');
    expect((errorThrown2 as Error).message).contains('closed');
  });

  it('Kill session by browserId', async () => {
    await start();
    const browser = await firefox.connect(
      `ws://localhost:3000/playwright/firefox?token=browserless`,
    );

    await fetch('http://localhost:3000/sessions?token=browserless').then(
      async (res) => {
        const sessions = await res.json();
        const browserId = sessions[0].browserId;
        await fetch(
          `http://localhost:3000/kill/${browserId}?token=browserless`,
        ).then(async (res) => {
          expect(res.status).to.equal(204);
        });
      },
    );

    let errorThrown;
    try {
      await browser.newPage();
    } catch (e) {
      errorThrown = e;
    }
    expect((errorThrown as Error).message).contains('closed');
  });

  it('Kill session by trackingId', async () => {
    await start();
    const browser = await firefox.connect(
      `ws://localhost:3000/playwright/firefox?token=browserless&trackingId=session-1`,
    );

    await fetch('http://localhost:3000/kill/session-1?token=browserless').then(
      async (res) => {
        expect(res.status).to.equal(204);
      },
    );

    let errorThrown;
    try {
      await browser.newPage();
    } catch (e) {
      errorThrown = e;
    }
    expect((errorThrown as Error).message).contains('closed');
  });
});
