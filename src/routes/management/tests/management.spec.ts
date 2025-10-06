import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

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

  describe('CORS', () => {
    it('allows Single Origin OPTIONS requests', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin('https://one.one.one.one');
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://one.one.one.one',
          },
        },
      );

      expect(r.status).to.equal(204);
      expect(r.headers.get('access-control-allow-origin')).to.equal(
        'https://one.one.one.one',
      );
    });

    it('allows wildcard orign OPTIONS requests', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin('*');
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://one.one.one.one',
          },
        },
      );

      expect(r.status).to.equal(204);
      expect(r.headers.get('access-control-allow-origin')).to.equal(
        'https://one.one.one.one',
      );
    });

    it('allows glob-matched OPTIONS requests', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin('*.one.one.one.one');
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://subdomain.one.one.one.one',
          },
        },
      );

      expect(r.status).to.equal(204);
      expect(r.headers.get('access-control-allow-origin')).to.equal(
        'https://subdomain.one.one.one.one',
      );
    });

    it('allows glob-matched OPTIONS requests with OR patterns', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin('https://(abc|xyz).one.one.one.one');
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://abc.one.one.one.one',
          },
        },
      );

      expect(r.status).to.equal(204);
      expect(r.headers.get('access-control-allow-origin')).to.equal(
        'https://abc.one.one.one.one',
      );
    });

    it('allows glob-matched OPTIONS requests with OR patterns across two domains', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin(
        '(https://(abc|xyz).one.one.one.one|https://deploy-preview-*.netlify.app)',
      );
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin:
              'https://deploy-preview-123--funky-monkey-12345.netlify.app',
          },
        },
      );

      expect(r.status).to.equal(204);
      expect(r.headers.get('access-control-allow-origin')).to.equal(
        'https://deploy-preview-123--funky-monkey-12345.netlify.app',
      );
    });

    it('should 404 when the origin does not match the CORS origin pattern', async () => {
      const config = new Config();
      config.enableCORS(true);
      config.setCORSOrigin('*.other.com');
      await start({ config });

      const r = await fetch(
        'http://localhost:3000/config?token=6R0W53R135510',
        {
          method: 'OPTIONS',
          headers: {
            Origin: 'https://subdomain.one.one.one.one',
          },
        },
      );

      expect(r.status).to.equal(404);
    });
  });

  describe('Static Files Serving', () => {
    it('serves docs pages', async () => {
      await start();

      await fetch(
        'http://localhost:3000/docs/index.html?token=6R0W53R135510',
      ).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal('text/html');
        const content = await res.text();
        expect(content).to.include('<title>Browserless Docs</title>');
      });

      await fetch(
        'http://localhost:3000/docs/docs.js?token=6R0W53R135510',
      ).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal(
          'application/javascript',
        );
        const content = await res.text();
        expect(content).to.be.an('string');
      });
    });

    it('serves swagger.json', async () => {
      await start();

      await fetch(
        'http://localhost:3000/docs/swagger.json?token=6R0W53R135510',
      ).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal('application/json');
        const content = await res.json();
        expect(content).to.be.an('object');
      });
    });

    it('returns 404 if debugger is disabled', async () => {
      process.env.ENABLE_DEBUGGER = 'false';
      const config = new Config();
      config.setToken('6R0W53R135510');
      // Ensure debugger is not available

      await start({ config });

      await fetch(
        'http://localhost:3000/debugger/some-file.html?token=6R0W53R135510',
      ).then(async (res) => {
        expect(res.status).to.equal(404);
        expect(res.headers.get('content-type')).to.equal(
          'text/plain; charset=UTF-8',
        );
      });
    });

    it('handles requests without authentication token for static files', async () => {
      await start();

      await fetch('http://localhost:3000/docs/index.html').then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.equal('text/html');
      });
    });
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

  it('allows requests to /meta', async () => {
    await start();

    await fetch('http://localhost:3000/meta?token=6R0W53R135510').then(
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

  it('allows requests to /kill', async () => {
    await start();

    await fetch('http://localhost:3000/kill/all?token=6R0W53R135510').then(
      async (res) => {
        expect(res.status).to.equal(204);
      },
    );
  });
  it('Throws an error trying to kill invalid session', async () => {
    await start();

    await fetch(
      `http://localhost:3000/kill/invalid-session?token=6R0W53R135510`,
    ).then(async (res) => {
      expect(res.status).to.equal(404);
    });
  });
});
