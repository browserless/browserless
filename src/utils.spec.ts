import { expect } from 'chai';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import {
  contentTypes,
  formatRequestURLForLog,
  getFinalPathSegment,
  getPageContent,
  makeDevtoolsFrontendURL,
  makeExternalWebSocketURL,
  toSetContentOptions,
  writeResponse,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';

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

  describe('#makeExternalWebSocketURL', () => {
    it('preserves the external path prefix without exposing a token', () => {
      const url = makeExternalWebSocketURL(
        'wss://browserless.example.com/prefix/',
        '/devtools/page/page-id',
      );

      expect(url.href).to.equal(
        'wss://browserless.example.com/prefix/devtools/page/page-id',
      );
      expect(url.searchParams.has('token')).to.be.false;
    });

    it('encodes tokens containing URL delimiters', () => {
      const token = 'token&with#a+percent%';
      const url = makeExternalWebSocketURL(
        'wss://browserless.example.com/prefix/',
        '/devtools/page/page-id',
        token,
      );

      expect(url.searchParams.get('token')).to.equal(token);
    });
  });

  describe('#makeDevtoolsFrontendURL', () => {
    it('uses the external WebSocket URL and encodes its nested token', () => {
      const token = 'token&with#a+percent%';
      const webSocketURL = makeExternalWebSocketURL(
        'wss://browserless.example.com/prefix/',
        '/devtools/page/page-id',
        token,
      );
      const frontendURL = makeDevtoolsFrontendURL(
        new URL(
          'https://browserless.example.com/prefix/devtools/inspector.html?ws=127.0.0.1:9222/devtools/page/page-id',
        ),
        webSocketURL,
      );

      expect(frontendURL.searchParams.has('ws')).to.be.false;
      const nestedURL = new URL(`wss://${frontendURL.searchParams.get('wss')}`);
      expect(nestedURL.host).to.equal('browserless.example.com');
      expect(nestedURL.pathname).to.equal('/prefix/devtools/page/page-id');
      expect(nestedURL.searchParams.get('token')).to.equal(token);
    });
  });

  describe('#formatRequestURLForLog', () => {
    for (const protocol of ['ws', 'wss']) {
      it(`redacts a token nested in ${protocol} without mutating the request`, () => {
        const nestedURL = new URL(
          `${protocol}://browserless.example.com/prefix/devtools/page/page-id`,
        );
        nestedURL.searchParams.set('token', 'super-secret');
        nestedURL.searchParams.set('keep', 'visible');
        const originalURL =
          `/devtools/inspector.html?trackingId=track-1&${protocol}=` +
          encodeURIComponent(
            `${nestedURL.host}${nestedURL.pathname}${nestedURL.search}`,
          );
        const request = {
          headers: { authorization: 'Bearer auth-token' },
          url: originalURL,
        } as unknown as IncomingMessage;

        const formatted = formatRequestURLForLog(request.url!);
        const parsed = new URL(formatted, 'http://localhost');
        const nested = new URL(
          `${protocol}://${parsed.searchParams.get(protocol)}`,
        );

        expect(formatted).not.to.include('super-secret');
        expect(parsed.pathname).to.equal('/devtools/inspector.html');
        expect(parsed.searchParams.get('trackingId')).to.equal('track-1');
        expect(nested.host).to.equal('browserless.example.com');
        expect(nested.pathname).to.equal('/prefix/devtools/page/page-id');
        expect(nested.searchParams.get('token')).to.equal('[redacted]');
        expect(nested.searchParams.get('keep')).to.equal('visible');
        expect(request.url).to.equal(originalURL);
        expect(request.headers.authorization).to.equal('Bearer auth-token');
      });
    }

    it('redacts a top-level token without mutating the input', () => {
      const originalURL = '/json/list?token=super-secret&trackingId=track-1';
      const formatted = formatRequestURLForLog(originalURL);
      const parsed = new URL(formatted, 'http://localhost');

      expect(formatted).not.to.include('super-secret');
      expect(parsed.searchParams.get('token')).to.equal('[redacted]');
      expect(parsed.searchParams.get('trackingId')).to.equal('track-1');
      expect(originalURL).to.equal(
        '/json/list?token=super-secret&trackingId=track-1',
      );
    });

    it('preserves an absolute URL while redacting its token', () => {
      const originalURL =
        'http://localhost:3000/json/list?token=super-secret&trackingId=track-1';
      const formatted = formatRequestURLForLog(originalURL);

      expect(formatted).to.equal(
        'http://localhost:3000/json/list?token=%5Bredacted%5D&trackingId=track-1',
      );
    });

    it('redacts nested tokens from malformed WebSocket targets', () => {
      const originalURL =
        '/devtools/inspector.html?ws=' +
        encodeURIComponent('%%%?token=super-secret&keep=visible');
      const formatted = formatRequestURLForLog(originalURL);
      const parsed = new URL(formatted, 'http://localhost');
      const nested = parsed.searchParams.get('ws')!;

      expect(formatted).not.to.include('super-secret');
      expect(nested).to.include('token=%5Bredacted%5D');
      expect(nested).to.include('keep=visible');
      expect(originalURL).to.include('super-secret');
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

  describe('#getPageContent', () => {
    const makePage = (
      content: () => Promise<string>,
      waitForNavigation: () => Promise<unknown> = () => Promise.resolve(),
    ): { page: Page; contentCalls: () => number } => {
      const calls = { count: 0 };
      const page = {
        content: () => {
          calls.count += 1;
          return content();
        },
        waitForNavigation,
      } as unknown as Page;
      return { contentCalls: () => calls.count, page };
    };

    it('returns markup on the first successful read', async () => {
      const { page, contentCalls } = makePage(() =>
        Promise.resolve('<html></html>'),
      );
      expect(await getPageContent(page)).to.equal('<html></html>');
      expect(contentCalls()).to.equal(1);
    });

    it('retries after a navigation teardown error and returns markup', async () => {
      const results = [
        () =>
          Promise.reject(
            new Error(
              'Execution context was destroyed, most likely because of a navigation.',
            ),
          ),
        () => Promise.resolve('<html>ok</html>'),
      ];
      const { page, contentCalls } = makePage(() => results.shift()!());
      expect(await getPageContent(page)).to.equal('<html>ok</html>');
      expect(contentCalls()).to.equal(2);
    });

    it('rethrows non-navigation errors without retrying', async () => {
      const { page, contentCalls } = makePage(() =>
        Promise.reject(new Error('boom')),
      );
      let thrown: Error | undefined;
      await getPageContent(page).catch((err) => {
        thrown = err;
      });
      expect(thrown?.message).to.equal('boom');
      expect(contentCalls()).to.equal(1);
    });

    it('rethrows the teardown error once retries are exhausted', async () => {
      const { page, contentCalls } = makePage(() =>
        Promise.reject(new Error('Execution context was destroyed')),
      );
      let thrown: Error | undefined;
      await getPageContent(page, { retries: 2 }).catch((err) => {
        thrown = err;
      });
      expect(thrown?.message).to.include('Execution context was destroyed');
      expect(contentCalls()).to.equal(3);
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
