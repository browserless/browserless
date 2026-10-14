import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import { setImmediate } from 'node:timers/promises';
import { buildSchema, execute, parse } from 'graphql';
import type { WebSocket } from 'ws';
import type { BrowserQL } from './browserql.js';
import type { Context } from './context.js';
import { BQLWebSocketSession } from './ws-session.js';

class Socket extends EventEmitter {
  protocol = 'graphql-transport-ws';
  readyState = 1;
  frames: any[] = [];
  code?: number;
  send(data: string) {
    this.frames.push(JSON.parse(data));
  }
  close(code = 1000) {
    this.code = code;
    this.readyState = 3;
    this.emit('close');
  }
  receive(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('BrowserQL WebSocket transport', () => {
  let socket: Socket;
  let done: Promise<void>;
  let closed: number;
  let browser: EventEmitter;
  let apiEvents: EventEmitter;
  let failed: boolean;
  let service: Pick<
    BrowserQL,
    'execute' | 'subscribe' | 'version' | 'capabilities'
  >;
  const start = (
    options?: ConstructorParameters<typeof BQLWebSocketSession>[3],
  ) => {
    done = new BQLWebSocketSession(
      socket as unknown as WebSocket,
      service,
      {
        getBrowserInstance: () => browser,
        hasErrored: () => failed,
        onDisconnected: (listener: () => void) => {
          apiEvents.on('disconnected', listener);
          return () => apiEvents.off('disconnected', listener);
        },
        close: async () => {
          closed++;
        },
      } as unknown as Context,
      options,
    ).run();
  };
  const subscribe = (id: string, query = 'mutation { run }') =>
    socket.receive({ type: 'subscribe', id, payload: { query } });
  beforeEach(() => {
    closed = 0;
    browser = new EventEmitter();
    apiEvents = new EventEmitter();
    failed = false;
    socket = new Socket();
    service = {
      version: '1.2.3',
      capabilities: ['core', 'test'],
      execute: async () => ({ data: { run: true } }),
      subscribe: async () => ({ errors: [{ message: 'Not a stream' }] as any }),
    };
  });
  afterEach(async () => {
    socket.close();
    await done;
  });

  it('acks capabilities, echoes ping payload and completes an operation', async () => {
    start();
    socket.receive({ type: 'connection_init' });
    socket.receive({ type: 'ping', payload: { nonce: 7 } });
    subscribe('one');
    await setImmediate();
    assert.deepEqual(socket.frames, [
      {
        type: 'connection_ack',
        payload: { version: '1.2.3', capabilities: ['core', 'test'] },
      },
      { type: 'pong', payload: { nonce: 7 } },
      { id: 'one', type: 'next', payload: { data: { run: true } } },
      { id: 'one', type: 'complete' },
    ]);
  });

  it('formats errors without changing operation framing and exposes execution metadata', async () => {
    const operations: unknown[] = [];
    service.execute = async () => ({
      errors: [new Error('Unknown field')] as any,
    });
    start({
      formatResponse: (result) => ({
        ...result,
        errors: result.errors?.map((error) => ({
          ...error,
          message: `${error.message} [trace]`,
        })),
      }),
      onOperation: (operation) => operations.push(operation),
    });
    socket.receive({ type: 'connection_init' });
    subscribe('request-7', '{ invalid }');
    await setImmediate();
    assert.deepEqual(socket.frames[1], {
      id: 'request-7',
      type: 'error',
      payload: [{ message: 'Unknown field [trace]' }],
    });
    assert.deepEqual(operations, [
      {
        id: 'request-7',
        request: { query: '{ invalid }' },
        protocol: 'graphql-transport-ws',
      },
    ]);
  });

  it('closes cleanly if a stream response formatter throws', async () => {
    let returned = false;
    service.subscribe = async () =>
      (async function* () {
        try {
          yield { data: { event: true } };
        } finally {
          returned = true;
        }
      })();
    start({
      formatResponse: () => {
        throw new Error('Formatter failed');
      },
    });
    socket.receive({ type: 'connection_init' });
    subscribe('stream', 'subscription { event }');
    await setImmediate();
    assert.equal(socket.code, 1011);
    assert.equal(returned, true);
    assert.equal(closed, 1);
  });

  it('reports invalid frames and numbers only executed legacy requests', async () => {
    socket.protocol = '';
    const operations: any[] = [];
    const invalid: any[] = [];
    start({
      onOperation: (operation) => operations.push(operation),
      onValidationError: (error) => {
        invalid.push(error);
        throw new Error('Observer failed');
      },
      formatResponse: (result) => ({
        ...result,
        extensions: { formatted: true },
      }),
    });
    socket.emit('message', Buffer.from('{'));
    socket.receive({ operationName: { invalid: true } });
    socket.receive({ query: '{ version }' });
    await setImmediate();
    assert.deepEqual(
      invalid.map(({ reason, operationName }) => ({ reason, operationName })),
      [
        { reason: 'invalid_json', operationName: undefined },
        { reason: 'missing_query', operationName: undefined },
      ],
    );
    assert.deepEqual(
      operations.map(({ id, protocol }) => ({ id, protocol })),
      [{ id: 'legacy-1', protocol: 'legacy' }],
    );
    assert.equal(
      socket.frames.every((frame) => frame.extensions.formatted),
      true,
    );
    assert.equal(socket.code, undefined);
  });

  it('rejects empty legacy queries before execution and keeps the socket usable', async () => {
    socket.protocol = '';
    start({
      formatResponse: (result) => ({
        ...result,
        errors: result.errors?.map((error) => ({
          ...error,
          message: `${error.message} (requestId: example)`,
        })),
      }),
    });
    socket.receive({ query: '' });
    socket.receive({ query: '{ version }' });
    await setImmediate();
    assert.deepEqual(socket.frames, [
      {
        errors: [
          { message: 'Missing required "query" field (requestId: example)' },
        ],
      },
      { data: { run: true } },
    ]);
    assert.equal(socket.code, undefined);
  });

  it('reports syntax errors for empty negotiated queries without closing', async () => {
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('empty', '');
    await setImmediate();
    assert.equal(socket.frames[1].type, 'error');
    assert.match(socket.frames[1].payload[0].message, /Syntax Error/);
    assert.equal(socket.code, undefined);
  });

  it('reports invalid subscribe IDs before closing with the standard code', async () => {
    const invalid: unknown[] = [];
    start({ onValidationError: (error) => invalid.push(error) });
    socket.receive({ type: 'connection_init' });
    socket.receive({
      type: 'subscribe',
      id: 'bad',
      payload: { operationName: 'Example' },
    });
    await done;
    assert.equal(socket.code, 4400);
    assert.deepEqual(invalid, [
      {
        reason: 'invalid_subscribe',
        message: 'Invalid subscribe message',
        id: 'bad',
        operationName: 'Example',
      },
    ]);
  });

  it('serializes operations, cancels queued work and permits ID reuse without stale results', async () => {
    const pending = deferred<any>();
    let executions = 0;
    service.execute = async () =>
      ++executions === 1 ? pending.promise : { data: { run: executions } };
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('a');
    subscribe('b');
    await setImmediate();
    assert.equal(executions, 1);
    socket.receive({ type: 'complete', id: 'b' });
    socket.receive({ type: 'complete', id: 'a' });
    subscribe('a');
    pending.resolve({ data: { run: 'stale' } });
    await setImmediate();
    assert.equal(executions, 2);
    assert.deepEqual(socket.frames.slice(1), [
      { id: 'a', type: 'next', payload: { data: { run: 2 } } },
      { id: 'a', type: 'complete' },
    ]);
  });

  it('keeps a stream outside the operation queue and cancels it on complete', async () => {
    const event = deferred<IteratorResult<any>>();
    let returned = false;
    const stream: AsyncIterableIterator<any> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => event.promise,
      return: async () => {
        returned = true;
        event.resolve({ done: true, value: undefined });
        return { done: true, value: undefined };
      },
    };
    service.subscribe = async () => stream;
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('stream', 'subscription { events }');
    subscribe('mutation');
    await setImmediate();
    assert.equal(
      socket.frames.some((f) => f.id === 'mutation' && f.type === 'complete'),
      true,
    );
    socket.receive({ type: 'complete', id: 'stream' });
    await setImmediate();
    assert.equal(returned, true);
    assert.equal(
      socket.frames.some((f) => f.id === 'stream'),
      false,
    );
  });

  it('streams values and sends only error on a failed stream', async () => {
    service.subscribe = async () =>
      (async function* () {
        yield { data: { event: 1 } };
        throw new Error('Stream failed');
      })();
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('stream', 'subscription { events }');
    await setImmediate();
    assert.deepEqual(socket.frames.slice(1), [
      { id: 'stream', type: 'next', payload: { data: { event: 1 } } },
      { id: 'stream', type: 'error', payload: [{ message: 'Stream failed' }] },
    ]);
  });

  it('returns an iterator whose setup finishes after cancellation', async () => {
    const setup = deferred<any>();
    let returned = 0;
    service.subscribe = async () => setup.promise;
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('stream', 'subscription { events }');
    await setImmediate();
    socket.receive({ type: 'complete', id: 'stream' });
    setup.resolve({
      [Symbol.asyncIterator]() {
        return this;
      },
      next: async () => ({ done: false, value: { data: { event: 1 } } }),
      return: async () => {
        returned++;
        return { done: true };
      },
    });
    await setImmediate();
    assert.equal(returned, 1);
    assert.equal(socket.frames.length, 1);
  });

  it('closes a context promptly and drops queued work on disconnect', async () => {
    const pending = deferred<any>();
    let executions = 0;
    service.execute = async () => {
      executions++;
      return pending.promise;
    };
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('a');
    subscribe('b');
    await setImmediate();
    socket.close();
    await done;
    assert.equal(closed, 1);
    pending.resolve({ data: { run: true } });
    await setImmediate();
    assert.equal(executions, 1);
    assert.equal(socket.frames.length, 1);
  });

  for (const [name, messages, code] of [
    [
      'before initialization',
      [{ type: 'subscribe', id: 'a', payload: { query: '{ version }' } }],
      4401,
    ],
    [
      'duplicate initialization',
      [{ type: 'connection_init' }, { type: 'connection_init' }],
      4429,
    ],
    [
      'duplicate active ID',
      [
        { type: 'connection_init' },
        ...Array(2).fill({
          type: 'subscribe',
          id: 'a',
          payload: { query: '{ version }' },
        }),
      ],
      4409,
    ],
    ['unknown message', [{ type: 'unknown' }], 4400],
    [
      'invalid payload',
      [
        { type: 'connection_init' },
        { type: 'subscribe', id: 'a', payload: { query: 4 } },
      ],
      4400,
    ],
  ] as const) {
    it(`closes on ${name}`, async () => {
      start();
      messages.forEach((message) => socket.receive(message));
      await done;
      assert.equal(socket.code, code);
      assert.equal(closed, 1);
    });
  }

  it('uses error only for pre-execution failure and next for field errors', async () => {
    service.execute = async (request) =>
      request.query === '{ invalid }'
        ? { errors: [{ message: 'Unknown field' }] as any }
        : { data: null, errors: [{ message: 'Field failed' }] as any };
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('invalid', '{ invalid }');
    subscribe('field');
    await setImmediate();
    assert.deepEqual(
      socket.frames.slice(1).map((f) => [f.id, f.type]),
      [
        ['invalid', 'error'],
        ['field', 'next'],
        ['field', 'complete'],
      ],
    );
  });

  it('preserves GraphQL syntax error locations', async () => {
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('bad', 'mutation {');
    await setImmediate();
    assert.deepEqual(socket.frames[1].payload[0].locations, [
      { line: 1, column: 11 },
    ]);
  });

  it('accepts bare legacy operations without initialization', async () => {
    socket.protocol = '';
    start();
    socket.receive({ query: 'mutation { run }' });
    socket.receive({ query: '{ version }' });
    await setImmediate();
    assert.deepEqual(socket.frames, [
      { data: { run: true } },
      { data: { run: true } },
    ]);
    assert.equal(socket.code, undefined);
  });

  for (const protocol of ['', 'graphql-transport-ws']) {
    for (const source of ['browser', 'api']) {
      for (const pending of [false, true]) {
        it(`closes ${protocol || 'legacy'} on ${source} loss while ${pending ? 'executing' : 'idle'}`, async () => {
          const result = deferred<any>();
          socket.protocol = protocol;
          service.execute = async () => result.promise;
          start();
          if (protocol) socket.receive({ type: 'connection_init' });
          if (pending) {
            if (protocol) subscribe('a');
            else socket.receive({ query: 'mutation { run }' });
            await setImmediate();
          }
          const count = socket.frames.length;
          if (source === 'browser') browser.emit('close');
          else apiEvents.emit('disconnected');
          await setImmediate();
          assert.equal(socket.code, 1011);
          assert.equal(closed, 1);
          assert.equal(browser.listenerCount('close'), 0);
          assert.equal(apiEvents.listenerCount('disconnected'), 0);
          result.resolve({ data: { run: true } });
          await setImmediate();
          assert.equal(socket.frames.length, count);
        });
      }
    }

    it(`uses browser state, not resolver error text, for ${protocol || 'legacy'} results`, async () => {
      socket.protocol = protocol;
      const schema = buildSchema(
        'type Query { version: String } type Mutation { run: String }',
      );
      service.execute = async () => {
        const result = await execute({
          schema,
          document: parse('mutation { run }'),
          rootValue: {
            run() {
              throw new Error('Protocol error: Target closed');
            },
          },
        });
        assert.equal(
          result.errors?.[0].originalError?.message,
          'Protocol error: Target closed',
        );
        return result;
      };
      start();
      if (protocol) socket.receive({ type: 'connection_init' });
      const send = () =>
        protocol
          ? subscribe('a')
          : socket.receive({ query: 'mutation { run }' });
      send();
      await setImmediate();
      assert.equal(socket.code, undefined);
      failed = true;
      send();
      await setImmediate();
      assert.equal(socket.code, 1011);
    });

    it(`keeps ${protocol || 'legacy'} open when a thrown script error mimics disconnect`, async () => {
      socket.protocol = protocol;
      service.execute = async () => {
        throw new Error('Target closed');
      };
      start();
      if (protocol) {
        socket.receive({ type: 'connection_init' });
        subscribe('a');
      } else socket.receive({ query: 'mutation { run }' });
      await setImmediate();
      assert.equal(socket.code, undefined);
      socket.close();
      await done;
      assert.equal(browser.listenerCount('close'), 0);
      assert.equal(apiEvents.listenerCount('disconnected'), 0);
    });
  }

  it('preserves legacy JSON envelopes and closes on browser loss', async () => {
    socket.protocol = '';
    service.execute = async () => {
      failed = true;
      throw new Error('Target closed');
    };
    start();
    socket.emit('message', Buffer.from('{'));
    socket.receive({ query: '{ version }' });
    await done;
    assert.deepEqual(socket.frames, [
      { errors: [{ message: 'Invalid JSON message' }] },
      { errors: [{ message: 'Browser session has ended unexpectedly' }] },
    ]);
    assert.equal(socket.code, 1011);
  });
});
