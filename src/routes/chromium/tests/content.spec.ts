import {
  Browserless,
  Config,
  Metrics,
  sleep,
} from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/chromium/content API', function () {
  let browserless: Browserless;

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

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('x-response-code')).to.not.be.undefined;
      expect(res.headers.get('x-response-url')).to.not.be.undefined;
      expect(res.headers.get('x-response-ip')).to.not.be.undefined;
      expect(res.headers.get('x-response-por')).to.not.be.undefined;
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('allows requests with content-type charsets', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('x-response-code')).to.not.be.undefined;
      expect(res.headers.get('x-response-url')).to.not.be.undefined;
      expect(res.headers.get('x-response-ip')).to.not.be.undefined;
      expect(res.headers.get('x-response-por')).to.not.be.undefined;
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('cancels request when they are closed early', async () => {
    const config = new Config();
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://cnn.com',
    };
    const controller = new AbortController();
    const signal = controller.signal;
    const promise = fetch('http://localhost:3000/chromium/content', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
      signal,
    }).catch(async (error) => {
      await sleep(100);
      expect(error).to.have.property('name', 'AbortError');
      expect(metrics.get().error).to.equal(1);
      expect(metrics.get().successful).to.equal(0);
    });
    await sleep(1000);
    controller.abort();
    return promise;
  });

  it('404s GET requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch(
      'http://localhost:3000/chromium/content?token=browserless',
    ).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/plain; charset=UTF-8',
      );
      expect(res.status).not.to.equal(200);
    });
  });

  it('handles `waitForFunction` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
      waitForFunction: {
        fn: '() => 5 + 5',
      },
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('handles async `waitForFunction` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
      waitForFunction: {
        fn: 'async () => new Promise(resolve => resolve(5))',
      },
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForSelector` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
      waitForSelector: {
        selector: 'h1',
      },
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForTimeout` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
      waitForTimeout: 500,
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForEvent` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      html: `<script type="text/javascript">
      const event = new Event("customEvent");
      setTimeout(() => document.dispatchEvent(event), 1500);
      </script>`,
      waitForEvent: {
        event: 'customEvent',
      },
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('allows cookies', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      cookies: [{ domain: 'one.one.one.one', name: 'foo', value: 'bar' }],
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('times out requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch(
      'http://localhost:3000/chromium/content?token=browserless&timeout=10',
      {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ).then((res) => {
      expect(res.status).to.equal(408);
    });
  });

  it('rejects requests', async () => {
    const config = new Config();
    config.setConcurrent(0);
    config.setQueued(0);
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(await res.text()).to.equal('Too many requests\n');
      expect(res.status).to.equal(429);
    });
  });

  it('allows for providing http response payloads', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setTimeout(30000);
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      requestInterceptors: [
        {
          pattern: '.*data.json',
          response: {
            body: '{"data": 123}',
            contentType: 'application/json',
            status: 200,
          },
        },
      ],
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
    });
  });

  it('allows goto options', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      gotoOptions: {
        waitUntil: `networkidle2`,
      },
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
    });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/content', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('x-response-code')).to.not.be.undefined;
      expect(res.headers.get('x-response-url')).to.not.be.undefined;
      expect(res.headers.get('x-response-ip')).to.not.be.undefined;
      expect(res.headers.get('x-response-por')).to.not.be.undefined;
      expect(res.headers.get('content-type')).to.equal(
        'text/html; charset=UTF-8',
      );
      expect(res.status).to.equal(200);
    });
  });

  it('can accept insecure certs', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      gotoOptions: {
        waitUntil: `networkidle2`,
      },
      url: 'https://self-signed.badssl.com',
    };

    await fetch('http://localhost:3000/chromium/content?token=browserless&launch={"acceptInsecureCerts":true}', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(res.status).to.equal(200);
    });
  });
});
