import { expect } from 'chai';
import fs from 'fs/promises';
import { ServerResponse } from 'http';
import { Socket } from 'net';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import {
  Config,
  contentTypes,
  generateScratchDir,
  getFinalPathSegment,
  getPageContent,
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

    it('uses plain text for non-JSON errors', () => {
      const { res, getHead, getBody } = createMockResponse();
      const message = '<script>globalThis.exploited = true</script>';
      writeResponse(res, 400, message, contentTypes.html);

      expect(getHead().headers?.['Content-Type']).to.equal(
        'text/plain; charset=UTF-8',
      );
      expect(getBody()).to.equal(`${message}\n`);

      const socket = new PassThrough();
      writeResponse(socket, 400, message, contentTypes.html);
      expect(socket.read()?.toString()).to.include(
        'Content-Type: text/plain; charset=UTF-8',
      );
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
      expect(getHead().headers?.['Content-Type']).to.equal(
        'application/json; charset=UTF-8',
      );
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

describe('#generateScratchDir', () => {
  const config = new Config();

  before(async () => {
    const scratchRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'browserless-scratch-spec-'),
    );
    (config as unknown as { scratchDir: string }).scratchDir = scratchRoot;
  });

  after(async () => {
    await fs.rm(config.getScratchDir(), { recursive: true, force: true });
  });

  it('creates the directory under the configured scratch root', async () => {
    const scratchDir = await generateScratchDir(undefined, config);

    expect(scratchDir).to.be.a('string');
    expect(path.dirname(scratchDir!)).to.equal(config.getScratchDir());
    await fs.access(scratchDir!);
  });

  it('defaults the scratch root to a sibling of the data-dir root', () => {
    const originalScratchDir = process.env.SCRATCH_DIR;

    try {
      delete process.env.SCRATCH_DIR;
      expect(new Config().getScratchDir()).to.equal(
        path.join(os.tmpdir(), 'browserless-scratch-dirs'),
      );
    } finally {
      if (originalScratchDir === undefined) {
        delete process.env.SCRATCH_DIR;
      } else {
        process.env.SCRATCH_DIR = originalScratchDir;
      }
    }
  });

  /**
   * Chrome's process singleton puts a unix socket beneath TMPDIR and appends
   * ~45 bytes of its own, which sun_path caps at 108 in total. A full 36-char
   * session id here made Chrome exit at startup with "Socket path too long".
   */
  it('shortens the session id so a unix socket still fits beneath it', async () => {
    const sessionId = 'f0cb34d8-a697-4326-ae72-b71217b69f04';
    const scratchDir = await generateScratchDir(sessionId, config);
    const segment = path.basename(scratchDir!);

    expect(segment).to.have.length.of.at.most(16);
    expect(segment).to.not.equal(sessionId);
    // Still derived from the session, so scratch stays attributable.
    expect(sessionId.replace(/-/g, '')).to.include(segment);
  });

  it('throws when the root cannot be created', async () => {
    const unwritable = new Config();
    // A path under a regular file can never be created.
    const blockerRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'scratch-blocker-'),
    );
    const blocker = path.join(blockerRoot, 'file');
    await fs.writeFile(blocker, '');
    (unwritable as unknown as { scratchDir: string }).scratchDir = path.join(
      blocker,
      'nested',
    );

    try {
      let error: Error | undefined;
      await generateScratchDir(undefined, unwritable).catch((err) => {
        error = err;
      });

      expect(error).to.be.instanceOf(Error);
      expect(error?.message).to.include('Error creating scratch directory');
    } finally {
      await fs.rm(blockerRoot, { recursive: true, force: true });
    }
  });
});
