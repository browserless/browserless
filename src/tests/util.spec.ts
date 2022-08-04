import { IncomingMessage } from 'http';
import { PassThrough } from 'stream';

import { expect } from 'chai';

import { IBrowser } from '../types.d';
import * as utils from '../utils';

const getArgs = (overrides = {}) => ({
  args: [],
  blockAds: false,
  headless: true,
  ignoreDefaultArgs: false,
  ignoreHTTPSErrors: false,
  pauseOnConnect: false,
  slowMo: undefined,
  userDataDir: undefined,
  playwright: false,
  stealth: false,
  meta: null,
  ...overrides,
});

const getSeleniumAlwaysMatch = () => ({
  capabilities: {
    alwaysMatch: {
      browserName: 'chrome',
      'goog:chromeOptions': {
        args: ['--headless', '--no-sandbox'],
      },
    },
  },
  desiredCapabilities: {
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: ['--headless', '--no-sandbox'],
    },
  },
});

export const getSeleniumFirstMatch = () => ({
  capabilities: {
    firstMatch: [
      {
        browserName: 'chrome',
        'goog:chromeOptions': {
          args: ['--no-sandbox', '--headless'],
        },
      },
    ],
  },
  desiredCapabilities: {
    browserName: 'chrome',
    'goog:chromeOptions': {
      args: ['--no-sandbox', '--headless'],
    },
  },
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
        expect(
          utils.canPreboot(getArgs({ args: undefined }), getArgs()),
        ).to.equal(true);
      });

      it('returns true when it matches', () => {
        expect(utils.canPreboot(getArgs({ args: [] }), getArgs())).to.equal(
          true,
        );
      });

      it('returns true when args are the same', () => {
        expect(
          utils.canPreboot(
            getArgs({ args: ['--headless', '--window-size=1920,1080'] }),
            getArgs({ args: ['--window-size=1920,1080', '--headless'] }),
          ),
        ).to.equal(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(
            getArgs({ args: ['--headless', '--user-data-dir=/my-data'] }),
            getArgs({ args: ['--window-size=1920,1080', '--headless'] }),
          ),
        ).to.equal(false);
      });
    });

    describe('playwright', () => {
      it('returns false when playwright connects', () => {
        expect(
          utils.canPreboot(getArgs({ playwright: true }), getArgs()),
        ).to.equal(false);
      });

      it('returns false when default args says playwright: true', () => {
        expect(
          utils.canPreboot(
            getArgs({ playwright: true }),
            getArgs({ playwright: true }),
          ),
        ).to.equal(false);
      });
    });

    describe('headless', () => {
      it('returns true when undefined', () => {
        expect(
          utils.canPreboot(getArgs({ headless: undefined }), getArgs()),
        ).to.equal(true);
      });

      it('returns true when it matches', () => {
        expect(
          utils.canPreboot(getArgs({ headless: true }), getArgs()),
        ).to.equal(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(getArgs({ headless: false }), getArgs()),
        ).to.equal(false);
      });
    });

    describe('userDataDir', () => {
      it('returns true when undefined', () => {
        expect(
          utils.canPreboot(getArgs({ userDataDir: undefined }), getArgs()),
        ).to.equal(true);
      });

      it('returns true when it matches', () => {
        expect(
          utils.canPreboot(
            getArgs({ userDataDir: 'my-cache' }),
            getArgs({ userDataDir: 'my-cache' }),
          ),
        ).to.equal(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(getArgs({ userDataDir: 'my-cache' }), getArgs()),
        ).to.equal(false);
      });
    });

    describe('ignoreDefaultArgs', () => {
      it('returns true when undefined', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: undefined }),
            getArgs(),
          ),
        ).to.equal(true);
      });

      it('returns true when it matches', () => {
        expect(
          utils.canPreboot(getArgs({ ignoreDefaultArgs: false }), getArgs()),
        ).to.equal(true);
      });

      it('returns true when they are the same', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: ['--headless'] }),
            getArgs({ ignoreDefaultArgs: ['--headless'] }),
          ),
        ).to.equal(true);
      });

      it('returns true when they contain the same list', () => {
        expect(
          utils.canPreboot(
            getArgs({
              ignoreDefaultArgs: ['--headless', '--user-data-dir=cache-money'],
            }),
            getArgs({
              ignoreDefaultArgs: ['--user-data-dir=cache-money', '--headless'],
            }),
          ),
        ).to.equal(true);
      });

      it('returns false when it does not match', () => {
        expect(
          utils.canPreboot(
            getArgs({ ignoreDefaultArgs: ['--headless'] }),
            getArgs({ ignoreDefaultArgs: ['--user-data-dir=cache-money'] }),
          ),
        ).to.equal(false);
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

      expect(utils.getBasicAuthToken(req as any)).to.equal(token);
    });

    it('handles `username:password` formats', () => {
      const token = 'abc:';
      const authorization = `Basic ${Buffer.from(token).toString('base64')}`;

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).to.equal('abc');
    });

    it('handles spaces', () => {
      const token = 'abc';
      const authorization = `Bearer ${Buffer.from(token).toString('base64')}`;

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).to.equal('abc');
    });

    it('handles bare tokens', () => {
      const token = 'abc';
      const authorization = Buffer.from(token).toString('base64');

      const req = {
        headers: {
          authorization,
        },
      };

      expect(utils.getBasicAuthToken(req as any)).to.equal('abc');
    });

    it('returns undefined if nothing is there', () => {
      const req = {
        headers: {},
      };

      expect(utils.getBasicAuthToken(req as any)).to.equal(undefined);
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

        expect(utils.getTimeoutParam(req as any)).to.equal(undefined);
      });

      it('returns the timer in ms for numbers', () => {
        const req = {
          parsed: {
            query: {
              timeout: '2000',
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).to.equal(2000);
      });

      it('returns null for non-numbers', () => {
        const req = {
          parsed: {
            query: {
              timeout: 'wat',
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
      });

      it('returns null missing params', () => {
        const req = {
          parsed: {
            query: {},
          },
        };

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
      });

      it('returns null if multiple are specified', () => {
        const req = {
          parsed: {
            query: {
              timeout: [100, 200],
            },
          },
        };

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
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

        expect(utils.getTimeoutParam(req as any)).to.equal(undefined);
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

        expect(utils.getTimeoutParam(req as any)).to.equal(1000);
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

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
      });

      it('returns null missing params', () => {
        const req = {
          body: {
            desiredCapabilities: {},
          },
          method: 'POST',
          url: '/webdriver',
        };

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
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

        expect(utils.getTimeoutParam(req as any)).to.equal(null);
      });
    });
  });

  describe('#isWebDriver', () => {
    it('matches webdriver requests', () => {
      expect(
        utils.isWebdriver({
          method: 'post',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('matches GET webdriver requests', () => {
      expect(
        utils.isWebdriver({
          method: 'get',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('matches DELETE webdriver requests', () => {
      expect(
        utils.isWebdriver({
          method: 'delete',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('matches PUT webdriver requests', () => {
      expect(
        utils.isWebdriver({
          method: 'put',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('does NOT match puppeteer calls', () => {
      expect(
        utils.isWebdriver({
          method: 'get',
          url: '/',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(
        utils.isWebdriver({
          method: 'get',
          url: '/',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does NOT match API calls', () => {
      expect(
        utils.isWebdriver({
          method: 'post',
          url: '/function',
        } as IncomingMessage),
      ).to.equal(false);
    });
  });

  describe('#isWebDriverStart', () => {
    it('matches webdriver start calls', () => {
      expect(
        utils.isWebdriverStart({
          method: 'post',
          url: '/webdriver/session',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('does not match existing webdriver calls', () => {
      expect(
        utils.isWebdriverStart({
          method: 'get',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does not matches DELETE webdriver requests', () => {
      expect(
        utils.isWebdriverStart({
          method: 'delete',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does not matches PUT webdriver requests', () => {
      expect(
        utils.isWebdriverStart({
          method: 'PUT',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(
        utils.isWebdriverStart({
          method: 'get',
          url: '/',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does NOT match puppeteer calls', () => {
      expect(
        utils.isWebdriverStart({
          method: 'get',
          url: '/',
        } as IncomingMessage),
      ).to.equal(false);
    });

    it('does NOT match API calls', () => {
      expect(
        utils.isWebdriverStart({
          method: 'post',
          url: '/function',
        } as IncomingMessage),
      ).to.equal(false);
    });
  });

  describe('#isWebdriverClose', () => {
    it('matches session close calls', () => {
      expect(
        utils.isWebdriverClose({
          method: 'delete',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a',
        } as IncomingMessage),
      ).to.equal(true);
    });

    it('matches window close calls', () => {
      expect(
        utils.isWebdriverClose({
          method: 'delete',
          url: '/webdriver/session/3844eb32f13d2335724b5e3cdb4fa10a/window',
        } as IncomingMessage),
      ).to.equal(true);
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
        expect(
          utils.isWebdriverClose({
            method: 'delete',
            url,
          } as IncomingMessage),
        ).to.equal(false);
      });
    });
  });

  describe('#normalizeWebdriverStart', () => {
    describe('always-match calls', () => {
      it('sets a binary path', async () => {
        const req = bufferify(getSeleniumAlwaysMatch()) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(
          results.body.desiredCapabilities['goog:chromeOptions'],
        ).to.have.property('binary');
        expect(
          results.body.capabilities.alwaysMatch['goog:chromeOptions'],
        ).to.have.property('binary');
      });

      it('sets block-ads in the W3C format', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless:blockAds'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('blockAds');
        expect(results.params.blockAds).to.equal(true);
      });

      it('sets block-ads in the legacy format', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.blockAds'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('blockAds');
        expect(results.params.blockAds).to.equal(true);
      });

      it('sets block-ads to false by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('blockAds');
        expect(results.params.blockAds).to.equal(false);
      });

      it('gets the browserless token in the W3C format', async () => {
        const token = 'wat';
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless:token'] = token;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('token');
        expect(results.params.token).to.equal(token);
      });

      it('gets the browserless token in the legacy format', async () => {
        const token = 'wat';
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.token'] = token;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('token');
        expect(results.params.token).to.equal(token);
      });

      it('gets no browserless tokens when not present', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('token');
        expect(results.params.token).to.equal(undefined);
      });

      it('sets a tracking-id in the W3C format', async () => {
        const id = 'wat';
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless:trackingId'] = id;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('trackingId');
        expect(results.params.trackingId).to.equal(id);
      });

      it('sets a tracking-id in the legacy format', async () => {
        const id = 'wat';
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.trackingId'] = id;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('trackingId');
        expect(results.params.trackingId).to.equal(id);
      });

      it('sets a tracking-id to null by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('trackingId');
        expect(results.params.trackingId).to.equal(null);
      });

      it('sets pauseOnConnect', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['browserless.pause'] = true;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('pauseOnConnect');
        expect(results.params.pauseOnConnect).to.equal(true);
      });

      it('sets pauseOnConnect to false by default', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params).to.have.property('pauseOnConnect');
        expect(results.params.pauseOnConnect).to.equal(false);
      });

      it('sets a window size', async () => {
        const width = 1920;
        const height = 1080;
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['goog:chromeOptions'].args.push(
          `--window-size=${width},${height}`,
        );
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params.windowSize).to.eql({ width, height });
      });

      it('default sets a temporary directory for user-data', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params.browserlessDataDir);
        expect(results.params.isUsingTempDataDir).to.equal(true);
      });

      it('does not set a data-dir when one is present', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.desiredCapabilities['goog:chromeOptions'].args.push(
          `--user-data-dir=/some/path`,
        );
        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params.isUsingTempDataDir).to.equal(false);
        expect(results.params.browserlessDataDir).to.equal(null);
      });

      it('does not set a data-dir when one is present in alwaysMatch', async () => {
        const reqBody = getSeleniumAlwaysMatch() as any;
        reqBody.capabilities.alwaysMatch['goog:chromeOptions'].args.push(
          `--user-data-dir=/some/path`,
        );

        const req = bufferify(reqBody) as unknown;
        const results = await utils.normalizeWebdriverStart(
          req as IncomingMessage,
        );

        expect(results.params.isUsingTempDataDir).to.equal(false);
        expect(results.params.browserlessDataDir).to.equal(null);
      });
    });
  });

  describe('#injectHostIntoSession', () => {
    it('injects host/port into the session responses', () => {
      const host = new URL('http://localhost:3000');

      const browser = {
        _wsEndpoint:
          'ws://127.0.0.1:50791/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
        _id: '685638c2-f214-494b-b679-1efbe2f824ba',
        _trackingId: 'abc',
        _parsed: {
          port: 1377,
        },
      } as unknown as IBrowser;

      const session = {
        description: 'Example Site',
        devtoolsFrontendUrl:
          '/devtools/inspector.html?ws=127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
        id: '4F7E8BE0AA50EEABDE92330A2CFD8674',
        title: 'Example Domain',
        type: 'page',
        url: 'https://www.example.com/',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      };

      const result = utils.injectHostIntoSession(host, browser, session);

      expect(result.browserId).to.equal(browser._id);
      expect(result.description).to.equal(session.description);
      expect(result.id).to.equal(session.id);
      expect(result.title).to.equal(session.title);
      expect(result.type).to.equal(session.type);
      expect(result.url).to.equal(session.url);
      expect(result.trackingId).to.equal(browser._trackingId);
      expect(result.port).to.equal(browser._parsed.port);

      expect(result.browserWSEndpoint).to.equal(
        'ws://localhost:3000/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
      );
      expect(result.webSocketDebuggerUrl).to.equal(
        'ws://localhost:3000/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );

      // http://localhost:3000/devtools/inspector.html?ws=127.0.0.1:3000/devtools/page/C2A1CDF7419E198A608F3E5A0ECEFA1E
      expect(result.devtoolsFrontendUrl).to.equal(
        '/devtools/inspector.html?ws=localhost:3000/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
    });

    it('handles URLs no ports (80)', () => {
      const host = new URL('http://localhost');

      const browser = {
        _wsEndpoint:
          'ws://127.0.0.1:50791/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
        _id: '685638c2-f214-494b-b679-1efbe2f824ba',
        _trackingId: 'abc',
        _parsed: {
          port: 1377,
        },
      } as unknown as IBrowser;

      const session = {
        description: 'Example Site',
        devtoolsFrontendUrl:
          '/devtools/inspector.html?ws=127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
        id: '4F7E8BE0AA50EEABDE92330A2CFD8674',
        title: 'Example Domain',
        type: 'page',
        url: 'https://www.example.com/',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      };

      const result = utils.injectHostIntoSession(host, browser, session);

      expect(result.port).to.equal(browser._parsed.port);
      expect(result.browserWSEndpoint).to.equal(
        'ws://localhost/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
      );
      expect(result.webSocketDebuggerUrl).to.equal(
        'ws://localhost/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
      expect(result.devtoolsFrontendUrl).to.equal(
        '/devtools/inspector.html?ws=localhost/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
    });

    it('handles URLs with SSL', () => {
      const host = new URL('https://browserless.com');

      const browser = {
        _wsEndpoint:
          'ws://127.0.0.1:50791/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
        _id: '685638c2-f214-494b-b679-1efbe2f824ba',
        _trackingId: 'abc',
        _parsed: {
          port: 1377,
        },
      } as unknown as IBrowser;

      const session = {
        description: 'Example Site',
        devtoolsFrontendUrl:
          '/devtools/inspector.html?ws=127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
        id: '4F7E8BE0AA50EEABDE92330A2CFD8674',
        title: 'Example Domain',
        type: 'page',
        url: 'https://www.example.com/',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      };

      const result = utils.injectHostIntoSession(host, browser, session);

      expect(result.browserWSEndpoint).to.equal(
        'wss://browserless.com/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
      );
      expect(result.webSocketDebuggerUrl).to.equal(
        'wss://browserless.com/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
      expect(result.devtoolsFrontendUrl).to.equal(
        '/devtools/inspector.html?wss=browserless.com/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
    });

    it('handles URLs with base-paths', () => {
      const host = new URL('http://localhost/browserless');

      const browser = {
        _wsEndpoint:
          'ws://127.0.0.1:50791/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
        _id: '685638c2-f214-494b-b679-1efbe2f824ba',
        _trackingId: 'abc',
        _parsed: {
          port: 1377,
        },
      } as unknown as IBrowser;

      const session = {
        description: 'Example Site',
        devtoolsFrontendUrl:
          '/devtools/inspector.html?ws=127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
        id: '4F7E8BE0AA50EEABDE92330A2CFD8674',
        title: 'Example Domain',
        type: 'page',
        url: 'https://www.example.com/',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      };

      const result = utils.injectHostIntoSession(host, browser, session);

      expect(result.browserWSEndpoint).to.equal(
        'ws://localhost/browserless/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
      );
      expect(result.webSocketDebuggerUrl).to.equal(
        'ws://localhost/browserless/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
      expect(result.devtoolsFrontendUrl).to.equal(
        '/browserless/devtools/inspector.html?ws=localhost/browserless/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
    });

    it('handles URLs with base-paths, SSL and custom ports', () => {
      const host = new URL('https://my.cool.domain:500/proxy/browserless');

      const browser = {
        _wsEndpoint:
          'ws://127.0.0.1:50791/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
        _id: '685638c2-f214-494b-b679-1efbe2f824ba',
        _trackingId: 'abc',
        _parsed: {
          port: 1377,
        },
      } as unknown as IBrowser;

      const session = {
        description: 'Example Site',
        devtoolsFrontendUrl:
          '/devtools/inspector.html?ws=127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
        id: '4F7E8BE0AA50EEABDE92330A2CFD8674',
        title: 'Example Domain',
        type: 'page',
        url: 'https://www.example.com/',
        webSocketDebuggerUrl:
          'ws://127.0.0.1:50489/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      };

      const result = utils.injectHostIntoSession(host, browser, session);

      expect(result.port).to.equal(browser._parsed.port);
      expect(result.browserWSEndpoint).to.equal(
        'wss://my.cool.domain:500/proxy/browserless/devtools/browser/685638c2-f214-494b-b679-1efbe2f824ba',
      );
      expect(result.webSocketDebuggerUrl).to.equal(
        'wss://my.cool.domain:500/proxy/browserless/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
      expect(result.devtoolsFrontendUrl).to.equal(
        '/proxy/browserless/devtools/inspector.html?wss=my.cool.domain:500/proxy/browserless/devtools/page/4F7E8BE0AA50EEABDE92330A2CFD8674',
      );
    });
  });
});
