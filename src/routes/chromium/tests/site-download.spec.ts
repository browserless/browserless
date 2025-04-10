import { Browserless, Config, Metrics, sleep } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/chromium/site-download API', function () {
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

  describe('Basic functionality', () => {
    it('allows basic download requests', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.headers.get('content-type')).to.include('text/html');
        expect(res.headers.get('x-original-url')).to.equal('https://example.com');
        expect(res.headers.get('x-response-code')).to.equal('200');
        expect(res.headers.get('x-content-type')).to.include('text/html');
        expect(res.status).to.equal(200);
      });
    });

    it('404s GET requests', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });

      await fetch('http://localhost:3000/chromium/site-download?token=browserless').then((res) => {
        expect(res.status).to.equal(404);
      });
    });

    it('allows requests without token when auth token is not set', async () => {
      await start();
      const body = {
        url: 'https://example.com',
      };

      await fetch('http://localhost:3000/chromium/site-download', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.include('text/html');
      });
    });

    it('rejects requests with invalid token', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
      };

      await fetch('http://localhost:3000/chromium/site-download?token=invalid', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(401);
      });
    });
  });

  describe('Request options', () => {
    it('allows requests with custom headers and cookies', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        headers: {
          'User-Agent': 'Custom User Agent',
          'Accept-Language': 'en-US',
        },
        cookies: [{
          name: 'test-cookie',
          value: 'test-value',
          domain: 'example.com',
        }],
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.include('text/html');
      });
    });

    it('allows requests with goto options and wait selectors', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        gotoOptions: {
          waitUntil: 'networkidle0',
          timeout: 30000,
        },
        waitForSelector: {
          selector: 'h1',
          timeout: 5000,
        },
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
      });
    });

    it('handles viewport settings', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        viewport: {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 2,
        },
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
      });
    });

    it('handles custom user agent', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        userAgent: 'Custom User Agent String',
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
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

  describe('Session handling', () => {
    it('handles existing session downloads', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        useExistingSession: true,
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.include('text/html');
      });
    });

    it('includes session ID in response headers when provided', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        useExistingSession: true,
        sessionId: 'test-session',
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(200);
        expect(res.headers.get('x-session-id')).to.equal('test-session');
      });
    });
  });

  describe('Error handling', () => {
    it('handles errors for invalid URLs', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'not-a-valid-url',
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(500);
      });
    });

    it('handles missing URL parameter', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {};

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(400);
      });
    });

    it('handles invalid waitForSelector timeout', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        waitForSelector: {
          selector: '#non-existent',
          timeout: 1, // Very short timeout to trigger error
        },
      };

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(500);
      });
    });

    it('handles malformed JSON body', async () => {
      const config = new Config();
      config.setToken('browserless');
      const metrics = new Metrics();
      await start({ config, metrics });

      await fetch('http://localhost:3000/chromium/site-download?token=browserless', {
        body: 'not-json',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      }).then(async (res) => {
        expect(res.status).to.equal(400);
      });
    });
  });

  describe('Request cancellation', () => {
    it('cancels request when they are closed early', async () => {
      const config = new Config();
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
      };
      const controller = new AbortController();
      const signal = controller.signal;
      const promise = fetch('http://localhost:3000/chromium/site-download', {
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

    it('cleans up resources after cancellation', async () => {
      const config = new Config();
      const metrics = new Metrics();
      await start({ config, metrics });
      const body = {
        url: 'https://example.com',
        useExistingSession: true,
      };
      const controller = new AbortController();
      const signal = controller.signal;
      
      const promise = fetch('http://localhost:3000/chromium/site-download', {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
        signal,
      }).catch(async (error) => {
        await sleep(100);
        expect(error).to.have.property('name', 'AbortError');
        // Verify metrics show proper cleanup
        const currentMetrics = metrics.get();
        expect(currentMetrics.error).to.equal(1);
        expect(currentMetrics.successful).to.equal(0);
        expect(currentMetrics.timedout).to.equal(0);
        expect(currentMetrics.rejected).to.equal(0);
      });
      
      await sleep(1000);
      controller.abort();
      return promise;
    });
  });
}); 