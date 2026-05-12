import { expect } from 'chai';
import { ServerResponse } from 'http';
import { Socket } from 'net';
import {
  contentTypes,
  getFinalPathSegment,
  toSetContentOptions,
  writeResponse,
} from '@browserless.io/browserless';

describe('Utils', () => {
  describe('#getFinalPathSegment', () => {
    it('returns the final path segment', () => {
      expect(
        getFinalPathSegment(
          'https://www.browserless.io/some/random/path/segment',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with trailing slashes', () => {
      expect(
        getFinalPathSegment(
          'https://www.browserless.io/some/random/path/segment/',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with URLs that have query params', () => {
      expect(
        getFinalPathSegment(
          'https://www.browserless.io/some/random/path/segment?foo=bar',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with URLs that have fragments', () => {
      expect(
        getFinalPathSegment(
          'https://www.browserless.io/some/random/path/segment#foo=bar',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with trailing slashes, query-params and fragments', () => {
      expect(
        getFinalPathSegment(
          'https://www.browserless.io/some/random/path/segment/?foo=bar&baz=qux#hello=world',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with trailing slashes, query-params and fragments on websockets', () => {
      expect(
        getFinalPathSegment(
          'wss://www.browserless.io/some/random/path/segment/?foo=bar&baz=qux#hello=world',
        ),
      ).to.equal('segment');
    });

    it('returns the final path segment with malformed URLs', () => {
      expect(
        getFinalPathSegment(
          'wss://www.browserless.io/some/random/path/segment/&bad=query',
        ),
      ).to.equal('segment');
    });
  });

  describe('#writeResponse', () => {
    const createMockResponse = () => {
      const socket = new Socket();
      const res = new ServerResponse({ method: 'GET' } as any);
      res.assignSocket(socket);

      let writtenHead: { code?: number; headers?: Record<string, string> } = {};
      let body = '';

      res.writeHead = ((code: number, headers?: any) => {
        writtenHead = { code, headers };
        return res;
      }) as any;

      res.end = ((data?: any) => {
        body = typeof data === 'string' ? data : '';
        return res;
      }) as any;

      return { res, getHead: () => writtenHead, getBody: () => body };
    };

    it('returns plain text by default', () => {
      const { res, getHead, getBody } = createMockResponse();
      writeResponse(res, 400, 'Bad request');

      expect(getHead().code).to.equal(400);
      expect(getHead().headers?.['Content-Type']).to.include('text/plain');
      expect(getBody()).to.equal('Bad request\n');
    });

    it('returns plain text when contentType is text', () => {
      const { res, getHead, getBody } = createMockResponse();
      writeResponse(res, 404, 'Not found', contentTypes.text);

      expect(getHead().code).to.equal(404);
      expect(getHead().headers?.['Content-Type']).to.include('text/plain');
      expect(getBody()).to.equal('Not found\n');
    });

    it('returns JSON error object when contentType is json', () => {
      const { res, getHead, getBody } = createMockResponse();
      writeResponse(res, 400, 'Missing parameter', contentTypes.json);

      expect(getHead().code).to.equal(400);
      expect(getHead().headers?.['Content-Type']).to.include(
        'application/json',
      );
      const parsed = JSON.parse(getBody().trim());
      expect(parsed).to.deep.equal({ error: 'Missing parameter' });
    });

    it('returns JSON for 500 errors when contentType is json', () => {
      const { res, getHead, getBody } = createMockResponse();
      writeResponse(res, 500, 'Internal server error', contentTypes.json);

      expect(getHead().code).to.equal(500);
      expect(getHead().headers?.['Content-Type']).to.include(
        'application/json',
      );
      const parsed = JSON.parse(getBody().trim());
      expect(parsed).to.deep.equal({ error: 'Internal server error' });
    });

    it('returns JSON when contentType header includes json with charset', () => {
      const { res, getHead, getBody } = createMockResponse();
      writeResponse(
        res,
        408,
        'Validation failed',
        'application/json; charset=utf-8' as contentTypes,
      );

      expect(getHead().code).to.equal(408);
      const parsed = JSON.parse(getBody().trim());
      expect(parsed).to.deep.equal({ error: 'Validation failed' });
    });
  });

  describe('#toSetContentOptions', () => {
    it('returns undefined when input is undefined', () => {
      expect(toSetContentOptions(undefined)).to.equal(undefined);
    });

    it('passes through options without waitUntil', () => {
      expect(toSetContentOptions({ timeout: 1000 })).to.deep.equal({
        timeout: 1000,
      });
    });

    it('passes through supported scalar waitUntil', () => {
      expect(toSetContentOptions({ waitUntil: 'load' })).to.deep.equal({
        waitUntil: 'load',
      });
    });

    it('strips a scalar networkidle waitUntil', () => {
      expect(toSetContentOptions({ waitUntil: 'networkidle0' })).to.deep.equal(
        {},
      );
      expect(
        toSetContentOptions({ timeout: 5, waitUntil: 'networkidle2' }),
      ).to.deep.equal({ timeout: 5 });
    });

    it('filters networkidle entries out of waitUntil arrays', () => {
      expect(
        toSetContentOptions({
          waitUntil: ['load', 'networkidle0', 'domcontentloaded'],
        }),
      ).to.deep.equal({ waitUntil: ['load', 'domcontentloaded'] });
    });

    it('drops waitUntil entirely when only networkidle values were supplied', () => {
      expect(
        toSetContentOptions({
          waitUntil: ['networkidle0', 'networkidle2'],
        }),
      ).to.deep.equal({});
    });
  });
});
