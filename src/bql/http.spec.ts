import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { BrowserQL } from './browserql.js';
import type { Context } from './context.js';
import type { BQLBrowserAPIOptions } from './api/browser-api.js';
import type { Request } from '../http.js';
import { handleBQLHTTP } from './http.js';

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
      assert.equal(contexts.length, 3);
      assert.notEqual(contexts[0], contexts[1]);
      assert.equal(closed, 3);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
