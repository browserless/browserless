import { expect } from 'chai';

import { Browserless } from '../../../browserless.js';
import { Config } from '../../../config.js';
import { Metrics } from '../../../metrics.js';

describe('/function API', function () {
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

  it('runs functions', async () => {
    await start();
    const body = {
      code: `export default async function ({ page }) {
        return Promise.resolve({
          data: "ok",
          type: "application/text",
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      const json = await res.json();

      expect(json).to.have.property('data');
      expect(json.data).to.equal('ok');
      expect(res.status).to.equal(200);
    });
  });

  it('runs "application/javascript" functions', async () => {
    await start();
    const body = `export default async function ({ page }) {
      return Promise.resolve({
        data: "ok",
        type: "application/text",
      });
    }`;

    await fetch('http://localhost:3000/function?token=browserless', {
      body,
      headers: { 'Content-Type': 'application/javascript' },
      method: 'POST',
    }).then(async (res) => {
      const json = await res.json();
      expect(json).to.have.property('data');
      expect(json.data).to.equal('ok');
      expect(json.type).to.equal('application/text');
      expect(res.status).to.equal(200);
    });
  });

  it('runs functions that import libraries', async () => {
    const config = new Config();
    const metrics = new Metrics();

    await start({ config, metrics });
    const body = {
      code: `
      import 'https://code.jquery.com/jquery-3.6.0.min.js';
      export default async function ({ page }) {
        return Promise.resolve({
          data: typeof window.jQuery,
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      const json = await res.json();

      expect(json).to.have.property('data');
      expect(json.data).to.equal('function');
      expect(res.status).to.equal(200);
    });
  });

  it('runs functions with custom return types', async () => {
    const config = new Config();
    const metrics = new Metrics();

    await start({ config, metrics });
    const body = {
      code: `
      export default async function ({ page }) {
        return Promise.resolve({
          data: {
            status: 'ok',
          },
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      const json = await res.json();

      expect(res.headers.get('content-type')).to.equal(
        `application/json; charset=UTF-8`,
      );
      expect(json).to.have.property('data');
      expect(res.status).to.equal(200);
    });
  });

  it('times out requests', async () => {
    await start();

    const body = {
      code: `export default async function ({ page }) {
        return Promise.resolve({
          data: "ok",
          type: "application/text",
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless&timeout=10', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(408);
    });
  });

  it('rejects requests with bad content-types', async () => {
    const config = new Config();
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      code: `export default async function ({ page }) {
        return Promise.resolve({
          data: "ok",
          type: "application/text",
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'joelson',
      },
      method: 'POST',
    }).then(async (res) => {
      return expect(res.status).to.equal(404);
    });
  });

  it('rejects requests with 429', async () => {
    const config = new Config();
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      code: `export default async function ({ page }) {
        return Promise.resolve({
          data: "ok",
          type: "application/text",
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      return expect(res.status).to.equal(429);
    });
  });

  it('rejects requests that are unauthorized', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      code: `export default async function ({ page }) {
        return Promise.resolve({
          data: "ok",
          type: "application/text",
        });
      }`,
      context: {},
    };

    await fetch('http://localhost:3000/function?token=bless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      return expect(res.status).to.equal(401);
    });
  });
});
