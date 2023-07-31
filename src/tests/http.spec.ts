import { expect } from 'chai';

import { Browserless } from '../browserless.js';
import { Config } from '../config.js';
import { Metrics } from '../metrics.js';

describe('HTTP APIs', function () {
  // Server shutdown can take a few seconds
  // and so can these tests :/
  this.timeout(10000);

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
    return browserless.stop();
  });

  it('allows requests to /metrics', async () => {
    await start();

    const metrics = await fetch(
      `http://localhost:3000/metrics?token=browserless`,
    ).then((res) => res.json());

    expect(metrics).to.be.ok;
  });

  it('allows requests to /config', async () => {
    await start();

    const config = await fetch(
      `http://localhost:3000/config?token=browserless`,
    ).then((res) => res.json());

    expect(config).to.be.ok;
  });

  it.skip('allows requests to /pressure', async () => {
    await start();

    const pressure = await fetch(
      `http://localhost:3000/pressure?token=browserless`,
    ).then((res) => res.json());

    expect(pressure).to.be.ok;
  });

  describe('/function', () => {
    it.only('allows running functions', async () => {
      await start();

      const body = {
        code: `export default async ({ page }) => {
          return Promise.resolve('ok');
        }`,
        context: {},
      };

      return fetch(`http://localhost:3000/function?token=browserless`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).to.contain('ok');
        });
    });

    it.only('allows running "application/javascript" functions', async () => {
      await start();

      const body = `export default async ({ page }) => {
        return Promise.resolve('ok');
      }`;

      return fetch(`http://localhost:3000/function?token=browserless`, {
        body,
        headers: {
          'content-type': 'application/javascript',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).to.contain('ok');
        });
    });

    it('allows custom response-types', async () => {
      await start();

      const body = {
        code: `export default async ({ page }) => {
          return Promise.resolve({
            status: 'ok',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:3000/function?token=browserless`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.json())
        .then((res) => {
          expect(res.status).to.contain('ok');
        });
    });

    it('times-out requests', async () => {
      const config = new Config();
      config.setTimeout(1000);
      await start({ config });

      const body = {
        code: `export default async ({ page }) => {
          return new Promise(() => { // don't do nothing! });
        }`,
        context: {},
      };

      return fetch(`http://localhost:3000/function?token=browserless`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).catch((err) => {
        expect(err).to.have.property('errno');
        expect(err.errno).to.equal('ECONNRESET');
      });
    });

    it('catches errors', async () => {
      const error = 'net::ERR_ABORTED';
      await start();

      const body = {
        code: `export default async ({ page }) => {
          await page.goto('httpsss://example.com/');
        }`,
        context: {},
      };

      return fetch(`http://localhost:3000/function?token=browserless`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.ok).to.equal(false);
          return res.text();
        })
        .then((message) => {
          expect(message).to.contain(error);
        });
    });
  });
});
