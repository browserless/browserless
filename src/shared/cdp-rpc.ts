/**
 * Shared CDP-over-WebSocket RPC helper.
 *
 * Replaces 4 duplicated correlation-map patterns across replay-session.ts
 * and cdp-proxy.ts with a single Effect.callback-based implementation.
 *
 * Each CdpConnection manages one WebSocket and one correlation map.
 * The correlation map maps command IDs to pending Effect callbacks.
 *
 * The caller is responsible for:
 *   1. Opening the WebSocket
 *   2. Calling conn.handleResponse(msg) from their WS message handler
 *   3. Calling conn.drainPending() on WS close
 *   4. Calling conn.dispose() when done
 *
 * Usage:
 *   const conn = new CdpConnection(ws, { startId: 1, defaultTimeout: 30_000 });
 *   // Effect API:
 *   const result = yield* conn.send('DOM.getDocument', { depth: -1 });
 *   // Promise bridge (for imperative callers):
 *   const result = await conn.sendPromise('DOM.getDocument', { depth: -1 });
 */
import { Effect } from 'effect';
import type WebSocket from 'ws';
import { CdpSessionGone, CdpTimeout } from '../session/cf/cf-errors.js';
import type { CdpSessionId } from './cloudflare-detection.js';

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

interface PendingCommand {
  resume: (effect: Effect.Effect<any, CdpSessionGone | CdpTimeout>) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CdpConnectionOptions {
  /** Starting command ID. Use distinct ranges to prevent collisions when
   *  multiple connections share the same browser. Existing conventions:
   *    replay-session browser WS: 1
   *    replay-session page WS:    100_000
   *    cdp-proxy browser WS:      200_000
   *    cdp-proxy isolated WS:     300_000
   *    solve-strategies clean WS:  500_000 */
  startId?: number;
  /** Default timeout for commands (ms). Default: 30_000. */
  defaultTimeout?: number;
}

// ═══════════════════════════════════════════════════════════════════════
// CdpConnection
// ═══════════════════════════════════════════════════════════════════════

export class CdpConnection {
  private nextId: number;
  private readonly defaultTimeout: number;
  private readonly pending = new Map<number, PendingCommand>();
  private disposed = false;

  constructor(
    private readonly ws: WebSocket,
    options: CdpConnectionOptions = {},
  ) {
    this.nextId = options.startId ?? 1;
    this.defaultTimeout = options.defaultTimeout ?? 30_000;
  }

  /**
   * Send a CDP command and wait for the response.
   *
   * Returns Effect<any, CdpSessionGone | CdpTimeout>.
   * - CdpTimeout: command timed out (Chrome under load, renderer stalled)
   * - CdpSessionGone: session disappeared (page navigated, tab closed)
   *
   * The Effect's interruption handler cleans up the pending entry and timer.
   */
  send(
    method: string,
    params?: object,
    sessionId?: CdpSessionId,
    timeoutMs?: number,
  ): Effect.Effect<any, CdpSessionGone | CdpTimeout> {
    return Effect.callback<any, CdpSessionGone | CdpTimeout>((resume) => {
      if (this.disposed || this.ws.readyState !== 1 /* OPEN */) {
        resume(Effect.fail(new CdpSessionGone({
          sessionId: sessionId ?? ('' as CdpSessionId),
          method,
        })));
        return;
      }

      const id = this.nextId++;
      const timeout = timeoutMs ?? this.defaultTimeout;

      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          resume(Effect.fail(new CdpTimeout({ method, timeoutMs: timeout })));
        }
      }, timeout);

      this.pending.set(id, { resume, timer });

      const msg: Record<string, any> = { id, method };
      if (params !== undefined) msg.params = params;
      if (sessionId !== undefined) msg.sessionId = sessionId;

      try {
        this.ws.send(JSON.stringify(msg));
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        resume(Effect.fail(new CdpSessionGone({
          sessionId: sessionId ?? ('' as CdpSessionId),
          method,
        })));
      }

      // Interruption cleanup: if the fiber is interrupted, remove the pending entry
      return Effect.sync(() => {
        const entry = this.pending.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          this.pending.delete(id);
        }
      });
    });
  }

  /**
   * Promise bridge for callers not yet on Effect.
   *
   * Converts CdpTimeout/CdpSessionGone into rejected Promises with
   * descriptive Error messages (matching existing behavior).
   */
  sendPromise(
    method: string,
    params?: object,
    sessionId?: CdpSessionId,
    timeoutMs?: number,
  ): Promise<any> {
    return Effect.runPromise(
      this.send(method, params, sessionId, timeoutMs).pipe(
        Effect.catchTag('CdpTimeout', (e) =>
          Effect.fail(new Error(`CDP command ${e.method} timed out after ${e.timeoutMs}ms`)),
        ),
        Effect.catchTag('CdpSessionGone', (e) =>
          Effect.fail(new Error(`CDP session gone during ${e.method} (session=${e.sessionId})`)),
        ),
      ),
    );
  }

  /**
   * Handle an incoming CDP response. Call this from your WS message handler.
   *
   * Returns true if the message was a response to a pending command
   * (and was consumed), false if it's an event or unrecognized.
   */
  handleResponse(msg: { id?: number; result?: any; error?: any }): boolean {
    if (msg.id === undefined) return false;

    const entry = this.pending.get(msg.id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(msg.id);

    if (msg.error) {
      entry.resume(Effect.fail(new CdpSessionGone({
        sessionId: '' as CdpSessionId,
        method: `response:${msg.id}`,
      })));
    } else {
      entry.resume(Effect.succeed(msg.result));
    }
    return true;
  }

  /**
   * Reject all pending commands (e.g. on WS close or session destroy).
   * Each pending command receives a CdpSessionGone error.
   */
  drainPending(reason = 'connection closed'): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resume(Effect.fail(new CdpSessionGone({
        sessionId: '' as CdpSessionId,
        method: `drain:${reason}`,
      })));
    }
    this.pending.clear();
  }

  /**
   * Mark as disposed. No new commands will be accepted.
   * Does NOT drain pending — call drainPending() first if needed.
   */
  dispose(): void {
    this.disposed = true;
  }

  /** Number of commands awaiting responses. */
  get pendingCount(): number {
    return this.pending.size;
  }
}
