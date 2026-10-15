import { strict as assert } from 'node:assert';
import { EventEmitter, once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  BrowserQL,
  Context,
  BQLWebSocketSession,
  BQL_WEBSOCKET_PROTOCOL,
} from '@browserless.io/browserless';

describe('BrowserQL WebSocket wire transport', () => {
  it('negotiates the standard protocol and also accepts unnegotiated legacy JSON', async () => {
    const sessions: Promise<void>[] = [];
    const closed = new Set<number>();
    const browsers = new Map<string, EventEmitter>();
    const server = new WebSocketServer({
      port: 0,
      host: '127.0.0.1',
      handleProtocols: (protocols) =>
        protocols.has(BQL_WEBSOCKET_PROTOCOL) ? BQL_WEBSOCKET_PROTOCOL : false,
    });
    const service = {
      capabilities: ['core'],
      version: '1.2.3',
      execute: async (body: { query: string }, context: Context) => ({
        data: {
          query: body.query,
          session: (context as unknown as { id: number }).id,
        },
      }),
      subscribe: async () => ({ data: {} }),
    } as Pick<BrowserQL, 'execute' | 'subscribe' | 'capabilities' | 'version'>;
    server.on('connection', (socket) => {
      const id = sessions.length + 1;
      const browser = new EventEmitter();
      browsers.set(socket.protocol, browser);
      const context = {
        id,
        getBrowserInstance: () => browser,
        hasErrored: () => false,
        onDisconnected: (listener: () => void) => {
          browser.on('disconnected', listener);
          return () => browser.off('disconnected', listener);
        },
        close: async () => {
          closed.add(id);
        },
      } as unknown as Context;
      sessions.push(new BQLWebSocketSession(socket, service, context).run());
    });
    await once(server, 'listening');
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const legacy = new WebSocket(url);
    const standard = new WebSocket(url, BQL_WEBSOCKET_PROTOCOL);
    try {
      await Promise.all([once(legacy, 'open'), once(standard, 'open')]);
      assert.equal(legacy.protocol, '');
      assert.equal(standard.protocol, BQL_WEBSOCKET_PROTOCOL);
      const legacyReply = once(legacy, 'message');
      legacy.send(JSON.stringify({ query: '{ version }' }));
      assert.deepEqual(JSON.parse(String((await legacyReply)[0])), {
        data: { query: '{ version }', session: 1 },
      });
      const ack = once(standard, 'message');
      standard.send(JSON.stringify({ type: 'connection_init' }));
      assert.deepEqual(JSON.parse(String((await ack)[0])), {
        type: 'connection_ack',
        payload: { version: '1.2.3', capabilities: ['core'] },
      });
      const frames: unknown[] = [];
      const complete = new Promise<void>((resolve) =>
        standard.on('message', (data) => {
          const frame = JSON.parse(data.toString());
          frames.push(frame);
          if (frame.type === 'complete') resolve();
        }),
      );
      standard.send(
        JSON.stringify({
          type: 'subscribe',
          id: 'one',
          payload: { query: '{ version }' },
        }),
      );
      await complete;
      assert.deepEqual(frames, [
        {
          id: 'one',
          type: 'next',
          payload: { data: { query: '{ version }', session: 2 } },
        },
        { id: 'one', type: 'complete' },
      ]);
      const legacyClosed = once(legacy, 'close');
      const standardClosed = once(standard, 'close');
      browsers.get('')!.emit('close');
      browsers.get(BQL_WEBSOCKET_PROTOCOL)!.emit('disconnected');
      assert.equal((await legacyClosed)[0], 1011);
      assert.equal((await standardClosed)[0], 1011);
    } finally {
      legacy.close();
      standard.close();
      await Promise.all(sessions);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    assert.deepEqual([...closed].sort(), [1, 2]);
  });
});
