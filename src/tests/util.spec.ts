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
});
