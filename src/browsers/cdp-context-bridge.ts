import {
  Config,
  Request,
  markSocketAsProxied,
} from '@browserless.io/browserless';
import WebSocket, { WebSocketServer } from 'ws';
import type { Duplex } from 'stream';
import type { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';

// Unlike a raw pipe, ws buffers complete inbound frames. Bound caller input;
// upstream responses remain unlimited for large PDFs/screenshots/body replies.
const server = new WebSocketServer({
  noServer: true,
  maxPayload: 100 * 1024 * 1024,
});
// Charge bookkeeping as well as payload so even empty queued frames are bounded.
const QUEUED_FRAME_OVERHEAD = 128;

/** Preserve the raw CDP contract, mediating only context configuration. */
export function bridgeCDPContexts(
  req: Request,
  socket: Duplex,
  head: Buffer,
  target: string,
  browser: EventEmitter,
  policy: NonNullable<ReturnType<Config['getCDPContextPolicy']>>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let client: WebSocket | undefined;
    let upstream: WebSocket | undefined;
    let settled = false;
    let closing = false;
    let closeTimer: NodeJS.Timeout | undefined;
    let processing = false;
    let queuedBytes = 0;
    let pending: ({ data: Buffer; binary: boolean } | undefined)[] = [];
    let pendingHead = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      pending.length = 0;
      clearTimeout(closeTimer);
      browser.off('close', onClose);
      socket.off('close', onSocketClose);
      socket.off('error', onClose);
      client?.terminate();
      upstream?.terminate();
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const onClose = () => finish();
    // Once upgraded, ws owns close metadata; the raw socket callback runs
    // before its close event and must not discard that event's code/reason.
    const onSocketClose = () => {
      if (!client) finish();
    };
    const relayClose = (
      peer: WebSocket | undefined,
      code: number,
      reason: Buffer,
    ) => {
      if (settled) return;
      closing = true;
      pending.length = 0;
      if (!peer || peer.readyState === WebSocket.CLOSED) return finish();
      if (peer.readyState === WebSocket.CONNECTING) return finish();
      if (code === 1006) return finish();
      peer.close(code === 1005 ? undefined : code, reason);
      closeTimer ??= setTimeout(() => finish(), 1000);
    };
    browser.once('close', onClose);
    socket.once('close', onSocketClose);
    socket.once('error', onClose);
    if (socket.destroyed) return finish();

    const flush = async () => {
      if (
        processing ||
        settled ||
        closing ||
        upstream?.readyState !== WebSocket.OPEN
      )
        return;
      processing = true;
      try {
        while (pendingHead < pending.length && !settled && !closing) {
          const message = pending[pendingHead]!;
          let frame;
          try {
            frame = JSON.parse(message.data.toString());
          } catch {
            // Only inspectable protocol objects may reach the browser.
            return finish();
          }
          if (!frame || typeof frame !== 'object' || Array.isArray(frame))
            return finish();
          let command = frame;
          let denied = false;
          try {
            while (command?.method === 'Target.sendMessageToTarget') {
              command = JSON.parse(command.params.message);
            }
            // Page bindings would issue browser commands outside this policy.
            if (command?.method === 'Target.exposeDevToolsProtocol') {
              throw new Error(
                'DevTools bindings are unavailable with a context policy',
              );
            }
            if (command?.method === 'Target.createBrowserContext') {
              await policy(command.params ?? {});
            }
          } catch {
            denied = true;
          }
          if (settled || closing) return;
          if (denied) {
            client!.send(
              JSON.stringify({
                id: frame.id,
                ...(frame.sessionId === undefined
                  ? {}
                  : { sessionId: frame.sessionId }),
                error: {
                  code: -32602,
                  message: 'CDP context policy rejected configuration',
                },
              }),
            );
          } else {
            // Pause only for write backpressure, never while awaiting policy:
            // reads must stay active to observe disconnects during admission.
            client!.pause();
            await new Promise<void>((resolve, reject) => {
              upstream!.send(
                message.data,
                { binary: message.binary },
                (error) => (error ? reject(error) : resolve()),
              );
            });
            if (!settled && !closing) client!.resume();
          }
          if (settled || closing) return;
          queuedBytes -= message.data.length + QUEUED_FRAME_OVERHEAD;
          pending[pendingHead++] = undefined;
          if (pendingHead === pending.length) {
            pending.length = 0;
            pendingHead = 0;
          } else if (pendingHead >= 1024 && pendingHead * 2 >= pending.length) {
            // Amortized linear consumption, including a never-empty stream.
            pending = pending.slice(pendingHead);
            pendingHead = 0;
          }
        }
      } catch (error) {
        finish(error as Error);
      } finally {
        processing = false;
        if (!settled && !closing && !pending.length) client?.resume();
      }
    };

    try {
      server.handleUpgrade(
        req as unknown as IncomingMessage,
        socket,
        head,
        (ws) => {
          client = ws;
          markSocketAsProxied(socket);
          ws.on('error', onClose);
          ws.once('close', (code, reason) =>
            relayClose(upstream, code, reason),
          );
          upstream = new WebSocket(target, {
            maxPayload: 0,
            perMessageDeflate: false,
          });
          upstream.on('error', finish);
          upstream.once('close', (code, reason) =>
            relayClose(ws, code, reason),
          );
          upstream.once('open', () => void flush());
          upstream.on('message', (data, binary) => {
            if (settled || closing) return;
            upstream!.pause();
            ws.send(data, { binary }, (error) => {
              if (error) finish(error);
              else if (!settled && !closing) upstream!.resume();
            });
          });
          ws.on('message', (data, binary) => {
            if (settled || closing) return;
            const buffer = Array.isArray(data)
              ? Buffer.concat(data)
              : Buffer.isBuffer(data)
                ? data
                : Buffer.from(data);
            // Bound payload plus bookkeeping rather than rejecting ordinary
            // bursts at 256 frames. Keep reads active during admission.
            const bytes = buffer.length + QUEUED_FRAME_OVERHEAD;
            if (
              pending.length > pendingHead &&
              queuedBytes + bytes > 100 * 1024 * 1024
            ) {
              relayClose(
                ws,
                1009,
                Buffer.from('CDP pending buffer limit exceeded'),
              );
              return;
            }
            queuedBytes += bytes;
            pending.push({ data: buffer, binary });
            void flush();
          });
        },
      );
    } catch (error) {
      finish(error as Error);
    }
  });
}
