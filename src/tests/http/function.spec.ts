import { expect } from 'chai';

import { Browserless } from '../../browserless.js';
import { Config } from '../../config.js';
import { Metrics } from '../../metrics.js';

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

  it.skip('runs "application/javascript" functions', async () => {
    await start();

    const body = `export default async function ({ page }) {
      return Promise.resolve({
        data: "ok",
        type: "application/text",
      });
    }`;

    await fetch(
      'http://localhost:3000/function?token=browserless', {
        body,
        headers: { 'Content-Type': 'application/javascript' },
        method: 'POST',  
      },
    ).then(async (res) => {
      expect(await res.text()).to.equal('browserless');
      expect(res.status).to.equal(200);
    });
  });

  it.skip('runs functions that import node libraries', async () => {
    const config = new Config();
    const metrics = new Metrics();

    await start({ config, metrics });
    const body = {
      code: `
      import util from 'util';
      export default async function ({ page }) {
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

  it.skip('runs functions that import external libraries', async () => {
    const config = new Config();
    const metrics = new Metrics();

    await start({ config, metrics });
    const body = {
      code: `
      import util from 'node-fetch';
      export default async function ({ page }) {
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

  it.skip('runs functions with custom content-types', async () => {
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
          type: "application/json",
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

  it.skip('rejects requests', async () => {
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
      expect(res.status).to.equal(429);
    });
  });

});
