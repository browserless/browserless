import * as utils from '../utils';

describe(`Utils`, () => {
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
});
