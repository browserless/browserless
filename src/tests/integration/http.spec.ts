import { BrowserlessServer } from '../../browserless-web-server';
import {
  defaultParams,
  killChrome,
} from './utils';

const fetch = require('node-fetch');

describe('Browserless Chrome HTTP', () => {
  let browserless: BrowserlessServer;
  const start = (args) => browserless = new BrowserlessServer(args);

  afterEach(async () => {
    browserless.close();

    return killChrome();
  });

  it('allows requests to /json/version', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/json/version`)
      .then((res) => res.json())
      .then((version) => {
        expect(Object.keys(version)).toMatchSnapshot();
      });
  });

  it('allows requests to /introspection', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/introspection`)
      .then((res) => res.json())
      .then((introspection) => {
        expect(introspection);
      });
  });

  it('allows requests to /json/protocol', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/json/protocol`)
      .then((res) => res.json())
      .then((protocol) => {
        expect(Object.keys(protocol)).toMatchSnapshot();
      });
  });

  it('allows requests to /metrics', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/metrics`)
      .then((res) => res.json())
      .then((metrics) => {
        expect(metrics).toMatchSnapshot();
      });
  });

  it('allows requests to /config', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/config`)
      .then((res) => res.json())
      .then((config) => {
        expect(Object.keys(config)).toMatchSnapshot();
      });
  });

  it('allows requests to /pressure', async () => {
    const browserless = start(defaultParams);
    await browserless.startServer();

    return fetch(`http://localhost:${defaultParams.port}/pressure`)
      .then((res) => res.json())
      .then((res) => {
        const { pressure } = res;
        expect(Object.keys(pressure)).toMatchSnapshot();
      });
  });

  describe('/function', () => {
    it('allows running functions', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).toBe('ok');
        });
    });

    it('allows running detached functions', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
        detached: true,
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.json())
        .then((res) => {
          expect(res).toHaveProperty('id');
        });
    });

    it('allows functions that require node built-ins', async () => {
      const browserless = start({
        ...defaultParams,
        functionBuiltIns: ['util'],
      });
      await browserless.startServer();

      const body = {
        code: `
        const util = require('util');
        module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).toBe('ok');
        });
    });

    it('allows functions that require external modules', async () => {
      const browserless = start({
        ...defaultParams,
        functionExternals: ['node-fetch'],
      });
      await browserless.startServer();

      const body = {
        code: `
        const fetch = require('node-fetch');
        module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).toBe('ok');
        });
    });

    it('denies functions that require node built-ins', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `
        const util = require('request');
        module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).toContain(`The module 'request' is not whitelisted in VM.`);
        });
    });

    it('denies functions that require external modules', async () => {
      const browserless = start({
        ...defaultParams,
        functionExternals: [],
      });
      await browserless.startServer();

      const body = {
        code: `
        const fetch = require('node-fetch');
        module.exports = ({ page }) => {
          return Promise.resolve({
            data: 'ok',
            type: 'application/text',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.text())
        .then((res) => {
          expect(res).toContain(`The module 'node-fetch' is not whitelisted in VM`);
        });
    });

    it('allows custom response-types', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `module.exports = ({ page }) => {
          return Promise.resolve({
            data: {
              status: 'ok',
            },
            type: 'application/json',
          });
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => res.json())
        .then((res) => {
          expect(res.status).toBe('ok');
        });
    });

    it('times-out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });
      await browserless.startServer();

      const body = {
        code: `module.exports = ({ page }) => {
          return new Promise(() => {});
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toEqual(408);
        });
    });

    it('catches errors', async () => {
      const error = 'Bad Request!';
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `module.exports = async ({ page }) => {
          throw new Error("${error}");
        }`,
        context: {},
      };

      return fetch(`http://localhost:${defaultParams.port}/function`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toEqual(400);
          expect(res.ok).toEqual(false);
          return res.text();
        })
        .then((message) => {
          expect(message).toEqual(error);
        });
    });
  });

  describe('/screenshot', () => {
    it('allows requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.headers.get('content-type')).toEqual('image/png');
          expect(res.status).toBe(200);
        });
    });

    it('allows cookies', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        cookies: [{ name: 'foo', value: 'bar', domain: 'example.com' }],
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then(async (res) => {
          expect(res.headers.get('content-type')).toEqual('image/png');
          expect(res.status).toBe(200);
        });
    });

    it('times out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(408);
        });
    });

    it('rejects requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(429);
        });
    });

    it('allows custom goto options', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        gotoOptions: {
          waitUntil: `networkidle2`,
        },
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });

    it('allows for injecting HTML', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        html: '<h1>Hello!</h1>',
      };

      return fetch(`http://localhost:${defaultParams.port}/screenshot`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });
  });

  describe('/screencast', () => {
    it('allows requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        code: `module.exports = async ({ page }) => {
          await page.goto('https://example.com/');
          await page.waitFor(5000);
        }`,
      };

      return fetch(`http://localhost:${defaultParams.port}/screencast`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.statusText ).toEqual('OK');
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toEqual('video/webm');
        });
    });

    it('allows "application/javascript" requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = `module.exports = async ({ page }) => {
        await page.goto('https://example.com/');
        await page.waitFor(5000);
      }`;

      return fetch(`http://localhost:${defaultParams.port}/screencast`, {
        body,
        headers: {
          'content-type': 'application/javascript',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.statusText ).toEqual('OK');
          expect(res.status).toBe(200);
          expect(res.headers.get('content-type')).toEqual('video/webm');
        });
    });

    it('times out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });

      await browserless.startServer();

      const body = {
        code: `module.exports = async ({ page }) => {
          await page.setContent('<h1>Hello, World!</h1>');
        }`,
      };

      return fetch(`http://localhost:${defaultParams.port}/screencast`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(408);
        });
    });

    it('rejects requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      const body = {
        code: `module.exports = async ({ page }) => {
          await page.setContent('<h1>Hello, World!</h1>');
        }`,
      };

      return fetch(`http://localhost:${defaultParams.port}/screencast`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(429);
        });
    });
  });

  describe('/pdf', () => {
    it('allows requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.headers.get('content-type')).toEqual('application/pdf');
          expect(res.status).toBe(200);
        });
    });

    it('allows cookies', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        cookies: [{ name: 'foo', value: 'bar', domain: 'example.com' }],
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.headers.get('content-type')).toEqual('application/pdf');
          expect(res.status).toBe(200);
        });
    });

    it('times out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(408);
        });
    });

    it('rejects requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(429);
        });
    });

    it('allows custom goto options', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        gotoOptions: {
          waitUntil: `networkidle2`,
        },
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });

    it('allows for injecting HTML', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        html: '<h1>Hello!</h1>',
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });

    it('allows for PDF options', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        html: '<h1>Hello!</h1>',
        options: {
          landscape: true,
        },
      };

      return fetch(`http://localhost:${defaultParams.port}/pdf`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });
  });

  describe('/content', () => {
    it('allows requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/content`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.headers.get('content-type')).toEqual('text/html; charset=utf-8');
          expect(res.status).toBe(200);
        });
    });

    it('allows cookies', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        cookies: [{ name: 'foo', value: 'bar', domain: 'example.com' }],
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/content`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.headers.get('content-type')).toEqual('text/html; charset=utf-8');
          expect(res.status).toBe(200);
        });
    });

    it('times out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/content`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(408);
        });
    });

    it('rejects requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/content`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(429);
        });
    });

    it('allows custom goto options', async () => {
      const browserless = start(defaultParams);

      await browserless.startServer();

      const body = {
        gotoOptions: {
          waitUntil: `networkidle2`,
        },
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/content`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });
  });

  describe('/stats', () => {
    jest.setTimeout(10000);
    it('allows requests', async () => {
      const browserless = start(defaultParams);
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/stats`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(200);
        });
    });

    it('times out requests', async () => {
      const browserless = start({
        ...defaultParams,
        connectionTimeout: 1,
      });
      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/stats`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(408);
        });
    });

    it('rejects requests', async () => {
      const browserless = start({
        ...defaultParams,
        maxConcurrentSessions: 0,
        maxQueueLength: 0,
      });

      await browserless.startServer();

      const body = {
        url: 'https://example.com',
      };

      return fetch(`http://localhost:${defaultParams.port}/stats`, {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })
        .then((res) => {
          expect(res.status).toBe(429);
        });
    });
  });
});
