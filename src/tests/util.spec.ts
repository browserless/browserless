import { PassThrough } from 'stream';
import * as utils from '../utils';
import { IncomingMessage } from 'http';

const getArgs = (overrides = {}) => ({
  args: [],
  blockAds: false,
  headless: true,
  ignoreDefaultArgs: false,
  ignoreHTTPSErrors: false,
  pauseOnConnect: false,
  slowMo: undefined,
  userDataDir: undefined,
  ...overrides,
});

const getSeleniumAlwaysMatch = () => ({
   'capabilities': {
      'alwaysMatch': {
         'browserName': 'chrome',
         'goog:chromeOptions': {
            'args': ['--headless', '--no-sandbox'],
         }
      }
   },
   'desiredCapabilities': {
      'browserName': 'chrome',
      'goog:chromeOptions': {
         'args': ['--headless', '--no-sandbox'],
      }
   }
});

const getSeleniumFirstMatch = () => ({
   'capabilities': {
      'firstMatch': [ {
         'browserName': 'chrome',
         'goog:chromeOptions': {
            'args': [ '--no-sandbox', '--headless' ],
         }
      } ]
   },
   'desiredCapabilities': {
      'browserName': 'chrome',
      'goog:chromeOptions': {
         'args': [ '--no-sandbox', '--headless' ],
      }
   }
});

const bufferify = (body: any) => {
  const bufferStream = new PassThrough();
  bufferStream.end(Buffer.from(JSON.stringify(body)));

  return Object.assign(bufferStream, {
    headers: {},
  });
};

describe(`Utils`, () => {
  // These only matter insomuch as that they can change launch flags
  describe('#canPreboot', () => {
    describe('args', () => {
      it('returns true when undefined', () => {
        expect(utils.canPreboot(getArgs({ args: undefined }), getArgs())).toBe(true);
      });

      it('returns true when it matches', () => {
        expect(utils.canPreboot(getArgs({ args: [] }), getArgs())).toBe(true);
      });

      it('returns true when args are the same', () => {
        expect(
          utils.canPreboot(
            getArgs({ args: ['--headless', '--window-size=1920,1080'] }),
            getArgs({ args: ['--window-size=1920,1080', '--headless'] })
          )
        ).toBe(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(
            getArgs({ args: ['--headless', '--user-data-dir=/my-data'] }),
            getArgs({ args: ['--window-size=1920,1080', '--headless'] })
          )
        ).toBe(false);
      });
    });

    describe('headless', () => {
      it('returns true when undefined', () => {
        expect(utils.canPreboot(getArgs({ headless: undefined }), getArgs())).toBe(true);
      });

      it('returns true when it matches', () => {
        expect(utils.canPreboot(getArgs({ headless: true }), getArgs())).toBe(true);
      });

      it('returns false when it does not match', () => {
        expect(utils.canPreboot(getArgs({ headless: false }), getArgs())).toBe(false);
      });
    });

    describe('userDataDir', () => {
      it('returns true when undefined', () => {
        expect(utils.canPreboot(getArgs({ userDataDir: undefined }), getArgs())).toBe(true);
      });

      it('returns true when it matches', () => {
        expect(utils.canPreboot(getArgs({ userDataDir: 'my-cache' }), getArgs({ userDataDir: 'my-cache' }))).toBe(true);
      });

      it('returns false when it does not match', () => {
        expect(utils.canPreboot(getArgs({ userDataDir: 'my-cache' }), getArgs())).toBe(false);
      });
    });

    describe('ignoreDefaultArgs', () => {
      it('returns true when undefined', () => {
        expect(utils.canPreboot(getArgs({ ignoreDefaultArgs: undefined }), getArgs())).toBe(true);
      });

      it('returns true when it matches', () => {
        expect(utils.canPreboot(getArgs({ ignoreDefaultArgs: false }), getArgs())).toBe(true);
      });

      it('returns true when they are the same', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: ['--headless'] }),
            getArgs({ ignoreDefaultArgs: ['--headless'] })
          )
        ).toBe(true);
      });

      it('returns true when they contain the same list', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: ['--headless', '--user-data-dir=cache-money'] }),
            getArgs({ ignoreDefaultArgs: ['--user-data-dir=cache-money', '--headless'] })
          )
        ).toBe(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: ['--headless'] }),
            getArgs({ ignoreDefaultArgs: ['--user-data-dir=cache-money'] })
          )
        ).toBe(false);
      });
    });
  });

  describe(`#getBasicAuthToken`, () => {
    it('returns the un-encoded token', () => {
      const token = 'abc';
      const authorization = `Basic ${Buffer.from(token).toString('base64')}`;

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).toEqual(token);
    });

    it('handles `username:password` formats', () => {
      const token = 'abc:';
      const authorization = `Basic ${Buffer.from(token).toString('base64')}`;

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).toEqual('abc');
    });

    it('handles spaces', () => {
      const token = 'abc';
      const authorization = `Bearer ${Buffer.from(token).toString('base64')}`;

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).toEqual('abc');
    });

    it('handles bare tokens', () => {
      const token = 'abc';
      const authorization = Buffer.from(token).toString('base64');

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).toEqual('abc');
    });

    it('returns empty if nothing is there', () => {
      const req = {
        headers: {
        },
      };

      expect(utils.getBasicAuthToken(req as any)).toEqual('');
    });
  });

  describe('#getTimeoutParam', () => {
    describe('for query-parameters', () => {
      it('returns undefined for -1', () => {
        const req = {
          parsed: {
            query: {
              timeout: '-1',
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(undefined);
      });

      it('returns the timer in ms for numbers', () => {
        const req = {
          parsed: {
            query: {
              timeout: '2000',
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(2000);
      });

      it('returns null for non-numbers', () => {
        const req = {
          parsed: {
            query: {
              timeout: 'wat',
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });

      it('returns null missing params', () => {
        const req = {
          parsed: {
            query: {},
          },
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });

      it('returns null if multiple are specified', () => {
        const req = {
          parsed: {
            query: {
              timeout: [100, 200],
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });
    });

    describe('for webdriver bodies', () => {
      it('returns undefined for -1', () => {
        const req = {
          body: {
            desiredCapabilities: {
              'browserless.timeout': -1,
            },
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(undefined);
      });

      it('returns the timer in ms for numbers', () => {
        const req = {
          body: {
            desiredCapabilities: {
              'browserless.timeout': 1000,
            },
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(1000);
      });

      it('returns null for non-numbers', () => {
        const req = {
          body: {
            desiredCapabilities: {
              'browserless.timeout': 'wat',
            },
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });

      it('returns null missing params', () => {
        const req = {
          body: {
            desiredCapabilities: {},
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });

      it('returns null if multiple are specified', () => {
        const req = {
          body: {
            desiredCapabilities: {
              'browserless.timeout': [123, 456],
            },
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).toEqual(null);
      });
    });
  });

  describe('#isWebDriver', () => {
    it('matches webdriver requests', () => {
      expect(utils.isWebdriver({
        method: 'post',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(true);
    });

    it('matches GET webdriver requests', () => {
      expect(utils.isWebdriver({
        method: 'get',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(true);
    });

    it('matches DELETE webdriver requests', () => {
      expect(utils.isWebdriver({
        method: 'delete',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(true);
    });

    it('matches PUT webdriver requests', () => {
      expect(utils.isWebdriver({
        method: 'put',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(true);
    });

    it('does NOT match puppeteer calls', () => {
      expect(utils.isWebdriver({
        method: 'get',
        url: '/',
      } as IncomingMessage)).toBe(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(utils.isWebdriver({
        method: 'get',
        url: '/',
      } as IncomingMessage)).toBe(false);
    });

    it('does NOT match API calls', () => {
      expect(utils.isWebdriver({
        method: 'post',
        url: '/function',
      } as IncomingMessage)).toBe(false);
    });
  });

  describe('#isWebDriverStart', () => {
    it('matches webdriver start calls', () => {
      expect(utils.isWebdriverStart({
        method: 'post',
        url: '/webdriver/session',
      } as IncomingMessage)).toBe(true);
    });

    it('does not match existing webdriver calls', () => {
      expect(utils.isWebdriverStart({
        method: 'get',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(false);
    });

    it('does not matches DELETE webdriver requests', () => {
      expect(utils.isWebdriverStart({
        method: 'delete',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(false);
    });

    it('does not matches PUT webdriver requests', () => {
      expect(utils.isWebdriverStart({
        method: 'PUT',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(utils.isWebdriverStart({
        method: 'get',
        url: '/',
      } as IncomingMessage)).toBe(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(utils.isWebdriverStart({
        method: 'get',
        url: '/',
      } as IncomingMessage)).toBe(false);
    });

    it('does NOT match API calls', () => {
      expect(utils.isWebdriverStart({
        method: 'post',
        url: '/function',
      } as IncomingMessage)).toBe(false);
    });
  });

  describe('#isWebdriverClose', () => {
    it('matches session close calls', () => {
      expect(utils.isWebdriverClose({
        method: 'delete',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
      } as IncomingMessage)).toBe(true);
    });

    it('matches window close calls', () => {
      expect(utils.isWebdriverClose({
        method: 'delete',
        url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/window',
      } as IncomingMessage)).toBe(true);
    });

    [
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/cookie',
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/cookie/window',
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/local_storage',
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/local_storage/key/window',
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/session_storage',
      '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/session_storage/key/',
    ].forEach((url) => {

      it(`does NOT match '${url}' URL`, () => {
        expect(utils.isWebdriverClose({
          method: 'delete',
          url,
        } as IncomingMessage)).toBe(false);
      });
    });
  });

  describe('#normalizeWebdriverStart', () => {
    describe('always-match calls', () => {
      it('sets a binary path', async () => {
        const req = bufferify(getSeleniumAlwaysMatch()) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.body.desiredCapabilities['goog:chromeOptions']).toHaveProperty('binary');
        expect(results.body.capabilities.alwaysMatch['goog:chromeOptions']).toHaveProperty('binary');
      });

      it('sets block-ads', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.blockAds'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('blockAds', true);
      });

      it('sets block-ads to false by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('blockAds', false);
      });

      it('sets a tracking-id', async () => {
        const id = 'wat';
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.trackingId'] = id;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('trackingId', id);
      });

      it('sets a tracking-id to null by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('trackingId', null);
      });

      it('sets pauseOnConnect', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.pause'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('pauseOnConnect', true);
      });

      it('sets pauseOnConnect to false by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('pauseOnConnect', false);
      });

      it('sets a window size', async () => {
        const width = 1920;
        const height = 1080;
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['goog:chromeOptions'].args.push(`--window-size=${width},${height}`);
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.windowSize).toEqual({ width, height });
      });

      it('default sets a temporary directory for user-data', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.browserlessDataDir);
        expect(results.params.isUsingTempDataDir).toBe(true);
      });

      it('does not set a data-dir when one is present', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['goog:chromeOptions'].args.push(`--user-data-dir=/some/path`);
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.isUsingTempDataDir).toBe(false);
        expect(results.params.browserlessDataDir).toEqual(null);
      });

      it('does not set a data-dir when one is present in alwaysMatch', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.capabilities.alwaysMatch['goog:chromeOptions'].args.push(`--user-data-dir=/some/path`);

        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.isUsingTempDataDir).toBe(false);
        expect(results.params.browserlessDataDir).toEqual(null);
      });
    });

    describe('first-match calls', () => {
      it('sets a binary path', async () => {
        const req = bufferify(getSeleniumFirstMatch()) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.body.desiredCapabilities['goog:chromeOptions']).toHaveProperty('binary');
        expect(results.body.capabilities.firstMatch[0]['goog:chromeOptions']).toHaveProperty('binary');
      });

      it('sets block-ads', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.desiredCapabilities['browserless.blockAds'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('blockAds', true);
      });

      it('sets block-ads to false by default', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('blockAds', false);
      });

      it('sets a tracking-id', async () => {
        const id = 'wat';
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.desiredCapabilities['browserless.trackingId'] = id;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('trackingId', id);
      });

      it('sets a tracking-id to null by default', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('trackingId', null);
      });

      it('sets pauseOnConnect', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.desiredCapabilities['browserless.pause'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('pauseOnConnect', true);
      });

      it('sets pauseOnConnect to false by default', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params).toHaveProperty('pauseOnConnect', false);
      });

      it('sets a window size', async () => {
        const width = 1920;
        const height = 1080;
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.capabilities.firstMatch[0]['goog:chromeOptions'].args.push(`--window-size=${width},${height}`);
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.windowSize).toEqual({ width, height });
      });

      it('default sets a temporary directory for user-data', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.browserlessDataDir);
        expect(results.params.isUsingTempDataDir).toBe(true);
      });

      it('does not set a data-dir when one is present', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.desiredCapabilities['goog:chromeOptions'].args.push(`--user-data-dir=/some/path`);
        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.isUsingTempDataDir).toBe(false);
        expect(results.params.browserlessDataDir).toEqual(null);
      });

      it('does not set a data-dir when one is present in `firstMatch`', async () => {
        const reqBody = getSeleniumFirstMatch() as any;
        reqBody.capabilities.firstMatch[0]['goog:chromeOptions'].args.push(`--user-data-dir=/some/path`);

        const req = bufferify(reqBody) as unknown;
        const results = (await utils.normalizeWebdriverStart(req as IncomingMessage));

        expect(results.params.isUsingTempDataDir).toBe(false);
        expect(results.params.browserlessDataDir).toEqual(null);
      });
    });
  });
});
