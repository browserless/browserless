import { strict as assert } from 'node:assert';
import {
  createServer,
  get,
  type IncomingMessage,
  ServerResponse,
} from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import {
  BrowserQL,
  Context,
  BQLBrowserAPIOptions,
  Request,
} from '@browserless.io/browserless';
import { handleBQLHTTP, writeBQLJSON } from './http.js';

describe('BrowserQL HTTP transport', () => {
  const options = {
    config: { getConcurrent: () => 1 },
    logger: { error() {} },
  } as unknown as BQLBrowserAPIOptions;

  for (const outcome of ['finish', 'close'] as const) {
    it(`reserves delivery capacity before execution until ${outcome}`, async () => {
      let executed = 0;
      let closed = 0;
      const bql = {
        capabilities: [],
        createContext: () => ({
          close: async () => {
            closed++;
          },
        }),
        execute: async () => {
          executed++;
          return { data: 'ok' };
        },
      } as unknown as BrowserQL;
      const response = () =>
        new ServerResponse({ method: 'POST' } as IncomingMessage);
      const run = (res: ServerResponse) =>
        handleBQLHTTP(
          { body: { query: '{ version }' } } as Request,
          res,
          {} as BQLBrowserAPIOptions['browser'],
          bql,
          options,
        );
      const first = response();
      await run(first);
      assert.equal(closed, 1);
      await assert.rejects(run(response()), { name: 'TooManyRequests' });
      assert.equal(executed, 1);
      first.emit(outcome);
      const next = response();
      await run(next);
      first.emit('close');
      await assert.rejects(run(response()), { name: 'TooManyRequests' });
      next.emit('close');
      assert.equal(executed, 2);
    });
  }

  it('returns GraphQL envelopes and capabilities with independent, closed contexts', async () => {
    const contexts: object[] = [];
    let closed = 0;
    const bql = {
      capabilities: ['core', 'test'],
      createContext: () =>
        ({
          close: async () => {
            closed++;
          },
        }) as Context,
      execute: async (body: { query: string }, context: Context) => {
        contexts.push(context);
        if (body.query === '{ crash }')
          throw new Error('Implementation detail');
        if (body.query === '{ serializationFailure }') {
          return {
            data: { large: 'x'.repeat(1024 * 1024) },
            get extensions() {
              throw new Error('Late serialization failure');
            },
          };
        }
        return body.query === '{ invalid }'
          ? { errors: [{ message: 'Unknown field' }] }
          : { data: { version: '1.2.3' } };
      },
    } as unknown as BrowserQL;
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      Object.assign(req, { body: JSON.parse(body) });
      await handleBQLHTTP(
        req as Request,
        res,
        {} as BQLBrowserAPIOptions['browser'],
        bql,
        options,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      for (const [body, status, expected] of [
        [{ query: '{ version }' }, 200, { data: { version: '1.2.3' } }],
        [
          { query: '{ invalid }' },
          200,
          { errors: [{ message: 'Unknown field' }] },
        ],
        [
          { query: '{ crash }' },
          500,
          { errors: [{ message: 'Internal server error' }] },
        ],
        [
          { query: '{ serializationFailure }' },
          500,
          { errors: [{ message: 'Internal server error' }] },
        ],
        [{ variables: [] }, 400, undefined],
      ] as const) {
        const response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(body),
        });
        assert.equal(response.status, status);
        assert.equal(response.headers.get('x-bql-capabilities'), 'core,test');
        const result = await response.json();
        if (expected) assert.deepEqual(result, expected);
        else assert.equal(Array.isArray(result.errors), true);
      }
      assert.equal(contexts.length, 4);
      assert.notEqual(contexts[0], contexts[1]);
      assert.equal(closed, 4);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('writes large results in bounded chunks without changing JSON bytes', async () => {
    const result = { data: { text: '😀\\"\n'.repeat(300000) } };
    const expected = JSON.stringify(result);
    let maximumWrite = 0;
    let writes = 0;
    let closed = 0;
    const server = createServer(async (req, res) => {
      const write = res.write.bind(res);
      const end = res.end.bind(res);
      res.write = ((chunk: Buffer | string, ...args: unknown[]) => {
        maximumWrite = Math.max(maximumWrite, Buffer.byteLength(chunk));
        writes++;
        return Reflect.apply(write, res, [chunk, ...args]);
      }) as typeof res.write;
      res.end = ((chunk?: Buffer | string, ...args: unknown[]) => {
        if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) {
          maximumWrite = Math.max(maximumWrite, Buffer.byteLength(chunk));
        }
        return Reflect.apply(end, res, [chunk, ...args]);
      }) as typeof res.end;
      await handleBQLHTTP(
        Object.assign(req, { body: { query: '{ large }' } }) as Request,
        res,
        {} as BQLBrowserAPIOptions['browser'],
        {
          capabilities: ['core'],
          createContext: () =>
            ({
              close: async () => {
                closed++;
              },
            }) as Context,
          execute: async () => result,
        } as unknown as BrowserQL,
        options,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    try {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      );
      assert.equal(response.status, 200);
      assert.equal(await response.text(), expected);
      assert.ok(
        maximumWrite <= 64 * 1024,
        `largest write was ${maximumWrite} bytes`,
      );
      assert.ok(writes > 1);
      assert.equal(closed, 1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('finishes the handler and closes the context while a loopback reader is paused', async () => {
    const size = 16 * 1024 * 1024;
    let handled = false;
    let finished = false;
    let closed = 0;
    const server = createServer(async (req, res) => {
      res.once('finish', () => {
        finished = true;
      });
      await handleBQLHTTP(
        Object.assign(req, { body: { query: '{ large }' } }) as Request,
        res,
        {} as BQLBrowserAPIOptions['browser'],
        {
          capabilities: [],
          createContext: () => ({
            close: async () => {
              closed++;
            },
          }),
          execute: async () => ({ data: 'x'.repeat(size) }),
        } as unknown as BrowserQL,
        options,
      );
      handled = true;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const [incoming] = await once(
        get(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
        'response',
      );
      const reader = incoming as IncomingMessage;
      reader.pause();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(handled, true);
      assert.equal(closed, 1);
      assert.equal(finished, false);
      let bytes = 0;
      for await (const chunk of reader) bytes += chunk.length;
      assert.equal(bytes, size + '{"data":""}'.length);
      assert.equal(finished, true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  for (const blocked of ['drain', 'finish']) {
    it(`destroys a response stalled waiting for ${blocked}`, async () => {
      const res = new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, callback) {
          if (blocked !== 'drain') callback();
        },
        final() {},
      });
      await assert.rejects(
        writeBQLJSON(res as unknown as ServerResponse, 'data', undefined, 30),
        /stalled/,
      );
      assert.equal(res.destroyed, true);
      for (const event of ['drain', 'finish', 'close', 'error'])
        assert.equal(res.listenerCount(event), 0);
    });
  }

  it('allows progressing writes to outlast one stall interval', async () => {
    const res = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, cb) {
        setTimeout(cb, 10);
      },
    });
    const start = Date.now();
    await writeBQLJSON(
      res as unknown as ServerResponse,
      'x'.repeat(1024 * 1024),
      undefined,
      100,
    );
    assert.ok(Date.now() - start > 100);
    assert.ok(res.writableFinished);
  });

  it('waits for a slow consumer to drain before writing more', async () => {
    const chunks: Buffer[] = [];
    let release: (() => void) | undefined;
    const res = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        release = callback;
      },
    });
    const value = { data: { text: 'large result '.repeat(300000) } };
    const writing = writeBQLJSON(res as unknown as ServerResponse, value);
    await setImmediate();
    assert.equal(chunks.length, 1);
    await setImmediate();
    assert.equal(chunks.length, 1, 'must not write while waiting for drain');
    for (let drains = 0; !res.writableEnded && drains < 1000; drains++) {
      const callback = release;
      release = undefined;
      callback?.();
      await setImmediate();
    }
    assert.equal(res.writableEnded, true);
    await writing;
    assert.equal(Buffer.concat(chunks).toString(), JSON.stringify(value));
    assert.ok(chunks.every((chunk) => chunk.length <= 64 * 1024));
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
  });

  it('stops blocked writes on disconnect and closes the context exactly once', async () => {
    let writes = 0;
    let closed = 0;
    const res = Object.assign(
      new Writable({
        highWaterMark: 1,
        write(_chunk, _encoding, _callback) {
          writes++;
        },
      }),
      { setHeader() {} },
    );
    const handling = handleBQLHTTP(
      { body: { query: '{ large }' } } as Request,
      res as unknown as ServerResponse,
      {} as BQLBrowserAPIOptions['browser'],
      {
        capabilities: ['core'],
        createContext: () =>
          ({
            close: async () => {
              closed++;
            },
          }) as Context,
        execute: async () => ({ data: { text: 'x'.repeat(1024 * 1024) } }),
      } as unknown as BrowserQL,
      options,
    );
    await setImmediate();
    assert.equal(writes, 1);
    assert.equal(
      closed,
      1,
      'download backpressure must not retain the context',
    );
    await handling;
    res.destroy();
    await setImmediate();
    assert.equal(writes, 1);
    assert.equal(closed, 1);
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
  });

  it('rejects write errors without leaving drain or close listeners behind', async () => {
    const failure = new Error('socket write failed');
    const res = new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        callback(failure);
      },
    });
    await assert.rejects(
      writeBQLJSON(res as unknown as ServerResponse, { data: 'result' }),
      (error) => error === failure,
    );
    assert.equal(res.listenerCount('drain'), 0);
    assert.equal(res.listenerCount('close'), 0);
    assert.equal(res.listenerCount('error'), 0);
  });

  for (const outcome of ['finish', 'close', 'error'] as const) {
    it(`awaits final flushing and handles ${outcome} without retaining listeners`, async () => {
      let finalize: ((error?: Error) => void) | undefined;
      const res = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          finalize = callback;
        },
      });
      let settled = false;
      const writing = writeBQLJSON(res as unknown as ServerResponse, {
        ok: true,
      });
      void writing.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        },
      );
      const failure = new Error('final flush failed');
      try {
        await setImmediate();
        assert.equal(res.writableEnded, true);
        assert.equal(res.writableFinished, false);
        assert.equal(settled, false, 'must await finish, not just end()');
        if (outcome === 'error') {
          const rejected = assert.rejects(
            writing,
            (error) => error === failure,
          );
          finalize!(failure);
          await rejected;
        } else {
          if (outcome === 'close') res.destroy();
          else finalize!();
          await writing;
        }
        for (const event of ['finish', 'close', 'error', 'drain']) {
          assert.equal(res.listenerCount(event), 0, event);
        }
      } finally {
        res.destroy();
      }
    });
  }

  it('releases execution before final flush and observes late errors', async () => {
    let finalize: ((error?: Error) => void) | undefined;
    let closed = 0;
    const errors: unknown[] = [];
    const res = Object.assign(
      new Writable({
        write(_chunk, _encoding, callback) {
          res.headersSent = true;
          callback();
        },
        final(callback) {
          finalize = callback;
        },
      }),
      { headersSent: false, setHeader() {} },
    );
    const handling = handleBQLHTTP(
      { body: { query: '{ version }' } } as Request,
      res as unknown as ServerResponse,
      {} as BQLBrowserAPIOptions['browser'],
      {
        capabilities: [],
        createContext: () => ({
          close: async () => {
            closed++;
          },
        }),
        execute: async () => ({ data: 'result' }),
      } as unknown as BrowserQL,
      {
        config: options.config,
        logger: {
          error: (_message: string, error: unknown) => errors.push(error),
        },
      } as unknown as Pick<BQLBrowserAPIOptions, 'config' | 'logger'>,
    );
    try {
      await setImmediate();
      assert.equal(res.writableEnded, true);
      assert.equal(closed, 1, 'context must close before final flush');
      await handling;
      const failure = new Error('final flush failed');
      finalize!(failure);
      await setImmediate();
      assert.deepEqual(errors, [failure]);
      assert.equal(closed, 1);
      assert.equal(res.destroyed, true);
      for (const event of ['finish', 'close', 'error', 'drain']) {
        assert.equal(res.listenerCount(event), 0, event);
      }
    } finally {
      res.destroy();
    }
  });

  it('preserves pretty-print bytes and undefined bodies for reusable HTTP writing', async () => {
    for (const value of [
      { data: { unicode: '😀', omitted: undefined, list: [null, 1] } },
      undefined,
    ]) {
      const chunks: Buffer[] = [];
      const res = new Writable({
        write(chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk));
          callback();
        },
      });
      await writeBQLJSON(res as unknown as ServerResponse, value, 2);
      assert.equal(
        Buffer.concat(chunks).toString(),
        JSON.stringify(value, null, 2) ?? '',
      );
      assert.equal(res.writableEnded, true);
    }
  });
});
