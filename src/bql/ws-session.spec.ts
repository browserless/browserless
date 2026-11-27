import { EventEmitter } from 'node:events';
import { strict as assert } from 'node:assert';
import { setImmediate } from 'node:timers/promises';
import { buildSchema, execute, GraphQLError, parse } from 'graphql';
import type { WebSocket } from 'ws';
import Sinon from 'sinon';
import {
  BrowserQL,
  Context,
  BQLWebSocketSession,
} from '@browserless.io/browserless';

class Socket extends EventEmitter {
  protocol = 'graphql-transport-ws';
  readyState = 1;
  bufferedAmount = 0;
  frames: any[] = [];
  sizes: number[] = [];
  fragments: Buffer[] = [];
  code?: number;
  send(
    data: string | Buffer,
    options?: { fin?: boolean },
    callback?: (error?: Error) => void,
  ) {
    const buffer = Buffer.from(data);
    this.sizes.push(buffer.length);
    this.fragments.push(buffer);
    if (options?.fin !== false) {
      this.frames.push(JSON.parse(Buffer.concat(this.fragments).toString()));
      this.fragments = [];
    }
    callback?.();
  }
  close(code = 1000) {
    this.code = code;
    this.readyState = 3;
    this.emit('close');
  }
  terminate() {
    this.readyState = 2; // Real ws emits close asynchronously after destruction.
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

  it('admits the exact formatted subscription frame plus buffer and rejects one byte more', async () => {
    const id = '€😀';
    const value = { data: { event: 'résumé' } };
    const formatted = { ...value, extensions: { trace: 'request-€' } };
    const frame = { id, type: 'next', payload: formatted };
    const bytes = Buffer.byteLength(JSON.stringify(frame));
    for (const extra of [0, 1]) {
      let returned = false;
      service.subscribe = async () =>
        (async function* () {
          try {
            yield value;
          } finally {
            returned = true;
          }
        })();
      socket = new Socket();
      if (extra) {
        // Keep the handshake pending: cleanup cannot rely on a close event.
        Sinon.stub(socket, 'close')
          .callThrough()
          .onFirstCall()
          .callsFake((code = 1000) => {
            socket.code = code;
            socket.readyState = 2;
          });
      }
      start({
        maxSubscriptionBufferedBytes: bytes + 200,
        formatResponse: (result) => ({
          ...result,
          extensions: formatted.extensions,
        }),
      });
      socket.receive({ type: 'connection_init' });
      socket.bufferedAmount = 200 + extra;
      subscribe(id, 'subscription { event }');
      await setImmediate();
      if (extra) {
        assert.equal(socket.code, 1013);
        assert.equal(socket.readyState, 2);
        assert.equal(socket.frames.length, 1);
        assert.equal(socket.fragments.length, 0);
      } else {
        assert.deepEqual(socket.frames.slice(1), [
          frame,
          { id, type: 'complete' },
        ]);
        assert.equal(socket.code, undefined);
      }
      assert.equal(returned, true);
      socket.close();
      await done;
    }
  });

  it('checks subscription error and complete frames but leaves query/control/legacy output unchanged', async () => {
    for (const query of ['subscription { event }', '{ run }']) {
      socket = new Socket();
      service.subscribe = async () => ({
        errors: [new GraphQLError('large error')],
      });
      start({ maxSubscriptionBufferedBytes: 1 });
      socket.receive({ type: 'connection_init' });
      socket.receive({ type: 'ping', payload: { large: 'control' } });
      subscribe('id', query);
      await setImmediate();
      assert.equal(
        socket.code,
        query.startsWith('subscription') ? 1013 : undefined,
      );
      assert.equal(socket.frames[1].type, 'pong');
      if (!query.startsWith('subscription'))
        assert.equal(socket.frames[2].type, 'next');
      socket.close();
      await done;
    }
    socket = new Socket();
    service.subscribe = async () => (async function* () {})();
    start({ maxSubscriptionBufferedBytes: 1 });
    socket.receive({ type: 'connection_init' });
    subscribe('complete', 'subscription { event }');
    await setImmediate();
    assert.equal(socket.code, 1013);
    assert.equal(socket.frames.length, 1);
    socket.close();
    await done;
    socket = new Socket();
    socket.protocol = '';
    start({ maxSubscriptionBufferedBytes: 1 });
    socket.receive({ query: '{ run }' });
    await setImmediate();
    assert.deepEqual(socket.frames, [{ data: { run: true } }]);
    assert.equal(socket.code, undefined);
  });

  it('rejects immediately instead of draining when subscription admission is configured', async () => {
    service.subscribe = async () =>
      (async function* () {
        yield { data: { event: true } };
      })();
    start({ maxSubscriptionBufferedBytes: 25 * 1024 * 1024 });
    socket.receive({ type: 'connection_init' });
    socket.bufferedAmount = 26 * 1024 * 1024;
    subscribe('slow', 'subscription { event }');
    await setImmediate();
    assert.equal(socket.code, 1013);
    assert.equal(socket.frames.length, 1);
  });

  it('counts the serialized snapshot once and rejects before any oversized fragment', async () => {
    let calls = 0;
    const value = {
      toJSON() {
        calls++;
        return 'x'.repeat(128 * 1024);
      },
    };
    service.subscribe = async () =>
      (async function* () {
        yield { data: { event: value } };
      })();
    start({ maxSubscriptionBufferedBytes: 100_000 });
    socket.receive({ type: 'connection_init' });
    subscribe('large', 'subscription { event }');
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(socket.code, 1013);
    assert.equal(socket.sizes.length, 1);
    assert.equal(socket.fragments.length, 0);
  });

  it('checks buffer at queued subscription send time and ignores canceled queued output', async () => {
    for (const canceled of [false, true]) {
      socket = new Socket();
      let returned = false;
      service.subscribe = async () =>
        (async function* () {
          try {
            yield { data: { event: true } };
          } finally {
            returned = true;
          }
        })();
      const send = socket.send.bind(socket);
      let resume: (() => void) | undefined;
      Sinon.stub(socket, 'send').callsFake((data, options, callback) => {
        send(data, options);
        if (options?.fin === false && !resume) resume = () => callback?.();
        else callback?.();
      });
      start({ maxSubscriptionBufferedBytes: 256 });
      socket.receive({ type: 'connection_init' });
      socket.receive({ type: 'ping', payload: { value: 'x'.repeat(100_000) } });
      await setImmediate();
      assert.ok(resume);
      subscribe('stream', 'subscription { event }');
      await setImmediate();
      // It fitted when produced, but must be checked after the blocked write.
      socket.bufferedAmount = 256;
      if (canceled) socket.receive({ type: 'complete', id: 'stream' });
      resume();
      await setImmediate();
      assert.equal(socket.code, canceled ? undefined : 1013);
      assert.equal(
        socket.frames.some((frame) => frame.id === 'stream'),
        false,
      );
      assert.equal(returned, true);
      socket.close();
      await done;
    }
  });

  it('writes an admitted snapshot without revisiting toJSON', async () => {
    let calls = 0;
    service.subscribe = async () =>
      (async function* () {
        yield {
          data: {
            event: {
              toJSON() {
                return ++calls;
              },
            },
          },
        };
      })();
    start({ maxSubscriptionBufferedBytes: 256 });
    socket.receive({ type: 'connection_init' });
    subscribe('once', 'subscription { event }');
    await setImmediate();
    assert.equal(calls, 1);
    assert.deepEqual(socket.frames.slice(1), [
      { id: 'once', type: 'next', payload: { data: { event: 1 } } },
      { id: 'once', type: 'complete' },
    ]);
  });

  it('sends large results in bounded fragments as one complete message', async () => {
    const value = 'α😀\\"'.repeat(100_000);
    service.execute = async () => ({ data: { value } });
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('large');
    await setImmediate();
    assert.deepEqual(socket.frames.slice(1), [
      { id: 'large', type: 'next', payload: { data: { value } } },
      { id: 'large', type: 'complete' },
    ]);
    assert.ok(Math.max(...socket.sizes) <= 64 * 1024);
  });

  it('allows repeated seven-second write pauses with only one fragment outstanding', async () => {
    const value = 'x'.repeat(192 * 1024);
    service.execute = async () => ({ data: { value } });
    const send = socket.send.bind(socket);
    let resume: (() => void) | undefined;
    Sinon.stub(socket, 'send').callsFake((data, options, callback) => {
      send(data, options);
      if (!options?.fin) resume = callback;
      else callback?.();
    });
    const clock = Sinon.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout'],
    });
    try {
      start();
      socket.receive({ type: 'connection_init' });
      subscribe('slow');
      await setImmediate();
      for (let i = 0; i < 3; i++) {
        assert.ok(resume);
        const before = socket.sizes.length;
        await clock.tickAsync(7000);
        assert.equal(socket.readyState, 1);
        assert.equal(socket.sizes.length, before);
        resume();
        await setImmediate();
      }
      assert.deepEqual(socket.frames.at(-2), {
        id: 'slow',
        type: 'next',
        payload: { data: { value } },
      });
      assert.deepEqual(socket.frames.at(-1), { id: 'slow', type: 'complete' });
    } finally {
      clock.restore();
    }
  });

  it('finishes active output but drops queued output on cancellation without interleaving or pulling more values', async () => {
    const value = 'body'.repeat(100_000);
    let pulls = 0;
    service.subscribe = async () =>
      (async function* () {
        pulls++;
        yield { data: { value } };
        pulls++;
        yield { data: { value: 'unwanted' } };
      })();
    const send = socket.send.bind(socket);
    let resume: (() => void) | undefined;
    Sinon.stub(socket, 'send').callsFake((data, options, callback) => {
      send(data, options);
      if (options?.fin === false && !resume) resume = () => callback?.();
      else callback?.();
    });
    start();
    socket.receive({ type: 'connection_init' });
    subscribe('stream', 'subscription { event }');
    await setImmediate();
    assert.ok(resume);
    assert.equal(pulls, 1);
    subscribe('queued', 'subscription { event }');
    await setImmediate();
    assert.equal(pulls, 2);
    socket.receive({ type: 'complete', id: 'queued' });
    socket.receive({ type: 'ping', payload: { nonce: 9 } });
    socket.receive({ type: 'complete', id: 'stream' });
    resume();
    await setImmediate();
    assert.deepEqual(socket.frames.slice(1), [
      { id: 'stream', type: 'next', payload: { data: { value } } },
      { type: 'pong', payload: { nonce: 9 } },
    ]);
    assert.equal(pulls, 2);
  });

  for (const terminal of ['next', 'complete', 'error', 'permissive-error']) {
    it(`preserves reused IDs while canceled ${terminal} output waits behind another message`, async () => {
      service.subscribe = async ({ query }) =>
        (async function* () {
          if (typeof query === 'string' && query.includes('blocker'))
            yield { data: { value: 'x'.repeat(100_000) } };
          else if (terminal.endsWith('error')) throw new Error('stale');
        })();
      const send = socket.send.bind(socket);
      let resume: (() => void) | undefined;
      Sinon.stub(socket, 'send').callsFake((data, options, callback) => {
        send(data, options);
        if (options?.fin === false && !resume) resume = () => callback?.();
        else callback?.();
      });
      start({ strictProtocol: terminal !== 'permissive-error' });
      socket.receive({ type: 'connection_init' });
      subscribe('blocker', 'subscription { blocker }');
      await setImmediate();
      assert.ok(resume);
      subscribe(
        'reuse',
        terminal === 'next' ? 'mutation { run }' : 'subscription { event }',
      );
      await setImmediate();
      socket.receive({ type: 'complete', id: 'reuse' });
      if (terminal !== 'permissive-error') subscribe('reuse');
      socket.receive({ type: 'complete', id: 'blocker' });
      resume();
      await setImmediate();
      if (terminal === 'permissive-error') {
        subscribe('reuse');
        await setImmediate();
      }
      assert.deepEqual(
        socket.frames.filter((frame) => frame.id === 'reuse'),
        [
          { id: 'reuse', type: 'next', payload: { data: { run: true } } },
          { id: 'reuse', type: 'complete' },
        ],
      );
    });
  }

  it('can retain permissive control frames and queued duplicate IDs', async () => {
    start({ strictProtocol: false, echoPingPayload: false });
    subscribe('same');
    subscribe('same');
    await setImmediate();
    assert.equal(socket.frames.filter((f) => f.type === 'next').length, 2);
    socket.receive({ type: 'connection_init' });
    socket.receive({ type: 'connection_init' });
    socket.receive({ type: 'ping', payload: 'nonce' });
    socket.receive({ type: 'subscribe', id: 'bad', payload: {} });
    await setImmediate();
    assert.deepEqual(socket.frames.at(-2), { type: 'pong' });
    assert.deepEqual(socket.frames.at(-1), {
      id: 'bad',
      type: 'error',
      payload: [{ message: 'Invalid subscribe message' }],
    });
    subscribe('after');
    await setImmediate();
    assert.equal(socket.readyState, 1);
    assert.deepEqual(socket.frames.at(-1), { id: 'after', type: 'complete' });
  });

  it('skips completed queued subscriptions but permits ID reuse in permissive mode', async () => {
    const gate = deferred<void>();
    service.execute = async () => {
      await gate.promise;
      return { data: { run: true } };
    };
    const subscriptions: unknown[] = [];
    service.subscribe = async ({ query }) => {
      subscriptions.push(query);
      return (async function* () {
        yield { data: { event: true } };
      })();
    };
    start({ strictProtocol: false });
    subscribe('gate');
    await setImmediate();
    subscribe('same', 'subscription { cancelled }');
    socket.receive({ type: 'complete', id: 'same' });
    subscribe('same', 'subscription { control }');
    subscribe('mutation');
    socket.receive({ type: 'complete', id: 'mutation' });
    gate.resolve();
    await setImmediate();
    assert.deepEqual(subscriptions, ['subscription { control }']);
    assert.deepEqual(
      socket.frames.filter((f) => f.type === 'next').map((f) => f.id),
      ['gate', 'same', 'mutation'],
    );
  });

  it('retains running mutation results after complete in permissive mode', async () => {
    const pending = deferred<any>();
    service.execute = () => pending.promise;
    start({ strictProtocol: false });
    subscribe('mutation');
    await setImmediate();
    socket.receive({ type: 'complete', id: 'mutation' });
    pending.resolve({ data: { run: 'finished' } });
    await setImmediate();
    assert.deepEqual(socket.frames, [
      { id: 'mutation', type: 'next', payload: { data: { run: 'finished' } } },
      { id: 'mutation', type: 'complete' },
    ]);
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

  it('can omit ping payloads and customize parse errors without changing operation errors', async () => {
    start({
      echoPingPayload: false,
      formatParseError: (error) => ({ errors: [{ message: error.message }] }),
      formatResponse: (result) => ({
        ...result,
        errors: result.errors?.map((error) => ({
          ...error,
          message: `${error.message} [operation]`,
        })),
      }),
    });
    socket.receive({ type: 'connection_init' });
    socket.receive({ type: 'ping', payload: { nonce: 7 } });
    subscribe('invalid', 'mutation {');
    await setImmediate();
    assert.deepEqual(socket.frames.slice(1), [
      { type: 'pong' },
      {
        id: 'invalid',
        type: 'error',
        payload: [{ message: 'Syntax Error: Expected Name, found <EOF>.' }],
      },
    ]);
    service.execute = async () => ({
      errors: [{ message: 'operation failure' }] as any,
    });
    subscribe('failure');
    await setImmediate();
    assert.deepEqual(socket.frames.at(-1), {
      id: 'failure',
      type: 'error',
      payload: [{ message: 'operation failure [operation]' }],
    });
  });

  for (const protocol of ['', 'graphql-transport-ws']) {
    it(`releases a stalled ${protocol || 'legacy'} write without waiting for a close event`, async () => {
      socket.protocol = protocol;
      const clock = Sinon.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout'],
      });
      try {
        const value = 'x'.repeat(65 * 1024);
        let returned = false;
        service.execute = async () => ({ data: { value } });
        service.subscribe = async () =>
          (async function* () {
            try {
              yield { data: { value } };
            } finally {
              returned = true;
            }
          })();
        start();
        if (protocol) socket.receive({ type: 'connection_init' });
        await setImmediate();
        let late: (() => void) | undefined;
        const writes = Sinon.stub(socket, 'send').callsFake(
          (_, __, callback) => {
            late = callback;
          },
        );
        const request = () =>
          protocol
            ? subscribe('a', 'subscription { event }')
            : socket.receive({ query: '{ version }' });
        request();
        await setImmediate();
        assert.ok(late);
        assert.equal(writes.firstCall.args[1]?.fin, false);
        if (protocol) socket.receive({ type: 'ping' });
        else request();
        await clock.tickAsync(30_000);
        assert.equal(closed, 1);
        assert.equal(socket.readyState, 2);
        await done;
        late();
        await setImmediate();
        assert.equal(writes.callCount, 1);
        if (protocol) assert.equal(returned, true);
        assert.equal(browser.listenerCount('close'), 0);
        assert.equal(socket.listenerCount('message'), 0);
        assert.equal(clock.countTimers(), 0);
      } finally {
        clock.restore();
      }
    });
  }

  it('closes when bufferedAmount stays above the subscription admission limit', async () => {
    service.subscribe = async () =>
      (async function* () {
        yield { data: { event: true } };
      })();
    start();
    socket.receive({ type: 'connection_init' });
    socket.bufferedAmount = 32 * 1024 * 1024;
    subscribe('slow', 'subscription { event }');
    const clock = Sinon.useFakeTimers();
    try {
      await clock.tickAsync(5000);
      assert.equal(socket.code, 1013);
      assert.equal(closed, 1);
      assert.equal(socket.frames.length, 1);
    } finally {
      clock.restore();
    }
  });

  it('delays subscription output until bufferedAmount falls below the limit', async () => {
    service.subscribe = async () =>
      (async function* () {
        yield { data: { event: true } };
      })();
    start();
    socket.receive({ type: 'connection_init' });
    socket.bufferedAmount = 17 * 1024 * 1024;
    const clock = Sinon.useFakeTimers();
    try {
      subscribe('stream', 'subscription { event }');
      await clock.tickAsync(100);
      assert.equal(socket.frames.length, 1);
      socket.bufferedAmount = 0;
      await clock.tickAsync(25);
      assert.equal(socket.code, undefined);
      assert.deepEqual(socket.frames[1], {
        id: 'stream',
        type: 'next',
        payload: { data: { event: true } },
      });
    } finally {
      clock.restore();
    }
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
