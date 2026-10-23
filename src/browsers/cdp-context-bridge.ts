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
    const pending: { data: Buffer; binary: boolean }[] = [];
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
        while (pending.length && !settled && !closing) {
          const message = pending[0];
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
          queuedBytes -= message.data.length;
          pending.shift();
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
          upstream = new WebSocket(target, { maxPayload: 0 });
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
            // Bound buffered waiters, not a single admitted message: legacy CDP
            // had no 100 MiB payload ceiling. Pausing applies TCP backpressure.
            if (
              pending.length >= 256 ||
              (pending.length > 0 &&
                queuedBytes + buffer.length > 100 * 1024 * 1024)
            ) {
              finish();
              return;
            }
            queuedBytes += buffer.length;
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
