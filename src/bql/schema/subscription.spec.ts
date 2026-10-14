import assert from 'node:assert/strict';
import type { ExecutionResult } from 'graphql';
import { BQLBrowserAPI } from '../api/browser-api.js';
import { BrowserQL } from '../browserql.js';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const iterator = (result: AsyncIterable<ExecutionResult> | ExecutionResult) => {
  assert.ok(Symbol.asyncIterator in result, JSON.stringify(result));
  return result[Symbol.asyncIterator]();
};

class EventAPI extends BQLBrowserAPI {
  override async start() {}
  override async ensureConsoleCapture() {}
  override async close() {
    this.events.emit('close');
  }
  emit(event: string, value: unknown) {
    this.events.emit(event, value);
  }
  listeners(event: string) {
    return this.events.listenerCount(event);
  }
  override async getResponseBody() {
    return { body: 'payload', base64Encoded: false };
  }
}

describe('BrowserQL subscriptions', () => {
  it('filters events, maps headers and bodies selected via fragments, and releases an idle iterator', async () => {
    const api = new EventAPI(options);
    const service = new BrowserQL({ apiFactory: () => api });
    const context = service.createContext(options);
    const stream = iterator(
      await service.subscribe(
        {
          query:
            'subscription { response(url:["https://example.com/**"],status:[201],operator:and) { url status headers { name value } ...Body } } fragment Body on ResponseResponse { body base64Encoded }',
        },
        context,
      ),
    );
    const pending = stream.next();
    api.emit('response', {
      id: 'one',
      url: 'https://example.com/miss',
      status: 200,
      headers: {},
    });
    api.emit('response', {
      id: 'two',
      url: 'https://example.com/hit',
      status: 201,
      headers: { 'content-type': 'text/plain' },
    });
    assert.deepEqual(plain((await pending).value), {
      data: {
        response: {
          url: 'https://example.com/hit',
          status: 201,
          headers: [{ name: 'content-type', value: 'text/plain' }],
          body: 'payload',
          base64Encoded: false,
        },
      },
    });
    const idle = stream.next();
    await stream.return?.();
    assert.equal((await idle).done, true);
    assert.equal(api.listeners('response'), 0);
    await context.close();
  });

  it('keeps all three streams outside the mutation queue and closes them with the context', async () => {
    const api = new EventAPI(options);
    const service = new BrowserQL({
      apiFactory: () => api,
      modules: [
        {
          name: 'ping',
          typeDefs: 'extend type Mutation { ping: String }',
          resolvers: { Mutation: { ping: () => 'pong' } },
        },
      ],
    });
    const context = service.createContext(options);
    const streams = await Promise.all(
      ['console { text }', 'request { url }', 'response { status }'].map(
        async (selection) =>
          iterator(
            await service.subscribe(
              { query: `subscription { ${selection} }` },
              context,
            ),
          ),
      ),
    );
    const pending = streams.map((stream) => stream.next());
    assert.deepEqual(
      plain(await service.execute({ query: 'mutation { ping }' }, context)),
      { data: { ping: 'pong' } },
    );
    api.emit('console', { text: 'hello' });
    assert.deepEqual(plain((await pending[0]).value), {
      data: { console: { text: 'hello' } },
    });
    await context.close();
    assert.equal((await pending[1]).done, true);
    assert.equal((await pending[2]).done, true);
    for (const event of ['console', 'request', 'response'])
      assert.equal(api.listeners(event), 0);
  });
});
