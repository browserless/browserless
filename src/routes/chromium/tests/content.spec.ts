import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/content API', function () {
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
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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

  it('404s GET requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch('http://localhost:3000/content?token=browserless').then(
      (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'text/plain; charset=UTF-8',
        );
        expect(res.status).not.to.equal(200);
      },
    );
  });

  it('handles `waitForFunction` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://example.com',
      waitForFunction: {
        fn: '() => 5 + 5',
      },
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
      waitForFunction: {
        fn: 'async () => new Promise(resolve => resolve(5))',
      },
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
      waitForSelector: {
        selector: 'h1',
      },
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
      waitForTimeout: 500,
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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

    await fetch('http://localhost:3000/content?token=browserless', {
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
      cookies: [{ domain: 'example.com', name: 'foo', value: 'bar' }],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless&timeout=10', {
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
    config.setConcurrent(0);
    config.setQueued(0);
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content?token=browserless', {
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
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/content', {
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
});
