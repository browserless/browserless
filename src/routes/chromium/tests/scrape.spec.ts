import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/scrape API', function () {
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
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

    await fetch('http://localhost:3000/scrape?token=browserless').then(
      (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'text/plain; charset=UTF-8',
        );
        expect(res.status).not.to.equal(200);
      },
    );
  });

  it('handles debug options', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      debugOpts: {
        network: true,
      },
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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
      expect(json).to.have.property('debug');
      expect(json.debug).to.have.property('network');
    });
  });

  it('handles selector timeouts', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'blink',
          timeout: 1000,
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then(async (res) => {
      expect(await res.text()).to.contain('Timed out waiting for selector');
      expect(res.status).not.to.equal(200);
    });
  });

  it('handles `waitForFunction` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
      waitForFunction: {
        fn: '() => 5 + 5',
      },
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

  it('handles async `waitForFunction` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
      waitForFunction: {
        fn: 'async () => new Promise(resolve => resolve(5))',
      },
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

  it('handles `waitForSelector` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
      waitForSelector: {
        selector: 'h1',
      },
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

  it('handles `waitForTimeout` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
      waitForTimeout: 500,
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

  it('handles `waitForEvent` properties', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      html: `<script type="text/javascript">
      const event = new Event("customEvent");
      setTimeout(() => document.dispatchEvent(event), 1500);
      </script><a href="/">Link</a>`,
      waitForEvent: {
        event: 'customEvent',
      },
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal(
        'application/json; charset=UTF-8',
      );
    });
  });

  it('allows cookies', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      cookies: [{ domain: 'example.com', name: 'foo', value: 'bar' }],
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
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

  it('times out requests', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless&timeout=10', {
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
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(429);
    });
  });

  it('allows goto options', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(200);
    });
  });

  it('allows requests without token when auth token is not set', async () => {
    await start();
    const body = {
      elements: [
        {
          selector: 'a',
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/scrape', {
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
