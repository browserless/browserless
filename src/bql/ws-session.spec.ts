import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import { setImmediate } from 'node:timers/promises';
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
  let service: Pick<
    BrowserQL,
    'execute' | 'subscribe' | 'version' | 'capabilities'
  >;
  const start = () => {
    done = new BQLWebSocketSession(socket as unknown as WebSocket, service, {
      close: async () => {
        closed++;
      },
    } as unknown as Context).run();
  };
  const subscribe = (id: string, query = 'mutation { run }') =>
    socket.receive({ type: 'subscribe', id, payload: { query } });
  beforeEach(() => {
    closed = 0;
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
    service.subscribe = async () => ({
      [Symbol.asyncIterator]() {
        return this;
      },
      next: () => event.promise,
      return: async () => {
        returned = true;
        event.resolve({ done: true, value: undefined });
        return { done: true, value: undefined };
      },
    });
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

  it('preserves legacy JSON envelopes and closes on browser loss', async () => {
    socket.protocol = '';
    service.execute = async () => {
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
