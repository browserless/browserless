import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { AddressInfo } from 'net';
import { createServer } from 'http';
import { expect } from 'chai';

describe('/edge/performance API', function () {
  let browserless: Browserless;
  const pageServer = createServer((req, res) => {
    if (req.url === '/style.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('body { color: navy; padding: 20px; }');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<!doctype html><title>Performance fixture</title><link rel="stylesheet" href="/style.css"><h1>Local audit</h1>',
    );
  });

  before(async () => {
    await new Promise<void>((resolve) =>
      pageServer.listen(0, '127.0.0.1', resolve),
    );
  });

  after(() => {
    pageServer.close();
  });

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('allows requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/edge/performance?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'application/json; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('404s GET requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch(
      'http://localhost:3000/edge/performance?token=browserless',
    ).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/plain; charset=UTF-8',
      );
      expect(res.status).not.to.equal(200);
    });
  });

  it('allows setting config', async () => {
    const config = new Config();
    config.setTimeout(60_000);
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      config: {
        extends: 'lighthouse:default',
        settings: {
          onlyAudits: ['unminified-css'],
        },
      },
      url: `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}`,
    };

    await fetch('http://localhost:3000/edge/performance?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.headers.get('content-type')).to.equal(
        'application/json; charset=UTF-8',
      );
      expect(res.status).to.equal(200);

      const json = await res.json();
      expect(json).to.have.property('data');
      expect(json.data.audits).to.have.all.keys('unminified-css');
    });
  }).timeout(90_000);

  it('times out request', async () => {
    const config = new Config();
    config.setTimeout(10);
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/edge/performance?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(408);
    });
  });

  it('rejects requests', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setConcurrent(0);
    config.setQueued(0);
    config.setToken('browserless');
    await start({ config, metrics });

    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/edge/performance?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(429);
    });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/edge/performance', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'application/json; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });
});
