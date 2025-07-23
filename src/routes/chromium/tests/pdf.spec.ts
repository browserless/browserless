import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/chromium/pdf API', function () {
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json; charset=utf-8',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('x-response-code')).to.not.be.undefined;
      expect(res.headers.get('x-response-url')).to.not.be.undefined;
      expect(res.headers.get('x-response-ip')).to.not.be.undefined;
      expect(res.headers.get('x-response-por')).to.not.be.undefined;
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('404s GET requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    await fetch('http://localhost:3000/chromium/pdf?token=browserless').then(
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
      url: 'https://one.one.one.one',
      waitForFunction: {
        fn: '() => 5 + 5',
      },
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
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
      'http://localhost:3000/chromium/pdf?token=browserless&timeout=10',
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
    const metrics = new Metrics();
    config.setConcurrent(0);
    config.setQueued(0);
    config.setToken('browserless');

    await start({ config, metrics });

    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(429);
    });
  });

  it('allows for providing http response payloads', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setConcurrent(10);
    config.setQueued(10);
    config.setTimeout(30000);
    config.setToken('browserless');

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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('allows setting goto options', async () => {
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

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('allows setting HTML body', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      html: '<h1>Hello!</h1>',
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('allows setting PDF options', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      options: {
        landscape: true,
      },
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('allows custom viewports', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      url: 'https://one.one.one.one',
      viewport: {
        deviceScaleFactor: 3,
        height: 100,
        width: 100,
      },
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();
    const body = {
      url: 'https://one.one.one.one',
    };

    await fetch('http://localhost:3000/chromium/pdf', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      await res.body?.pipeTo(new WritableStream({}));
      expect(res.headers.get('x-response-code')).to.not.be.undefined;
      expect(res.headers.get('x-response-url')).to.not.be.undefined;
      expect(res.headers.get('x-response-ip')).to.not.be.undefined;
      expect(res.headers.get('x-response-por')).to.not.be.undefined;
      expect(res.headers.get('content-type')).to.equal('application/pdf');
      expect(res.status).to.equal(200);
    });
  });

  it('returns 400 when payload size exceeds maximum allowed size', async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setMaxPayloadSize(100); // Set a very small max payload size for testing
    const metrics = new Metrics();
    await start({ config, metrics });

    // Create a large payload that exceeds the 100 byte limit
    const body = {
      html: 'a'.repeat(200), // Create a 200 byte string
    };

    await fetch('http://localhost:3000/chromium/pdf?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      const errorText = await res.text();
      expect(res.status).to.equal(400);
      expect(errorText).to.include('Request payload size');
      expect(errorText).to.include('exceeds maximum allowed size');
    });
  });
});
