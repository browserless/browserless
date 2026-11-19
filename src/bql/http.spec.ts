import { strict as assert } from 'node:assert';
import { createServer, type ServerResponse } from 'node:http';
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
    const options = { logger: { error() {} } } as unknown as Pick<
      BQLBrowserAPIOptions,
      'config' | 'logger'
    >;
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
        { logger: { error() {} } } as unknown as Pick<
          BQLBrowserAPIOptions,
          'config' | 'logger'
        >,
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
      { logger: { error() {} } } as unknown as Pick<
        BQLBrowserAPIOptions,
        'config' | 'logger'
      >,
    );
    await setImmediate();
    assert.equal(writes, 1);
    assert.equal(closed, 0);
    res.destroy();
    await handling;
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
