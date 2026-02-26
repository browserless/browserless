import WebSocket from 'ws';
// ws is CJS — Server lives on default export at runtime but TS types don't expose it
const WebSocketServer = (WebSocket as any).Server as typeof import('ws').WebSocketServer;
import { Duplex } from 'stream';
import { IncomingMessage } from 'http';
import { Config, Logger } from '@browserless.io/browserless';
import { Schema } from 'effect';

import { CloudflareConfig } from './shared/cloudflare-detection.js';
import type { CdpSessionId, TargetId } from './shared/cloudflare-detection.js';

/**
 * Replay metadata sent via CDP event.
 */
export interface ReplayCompleteParams {
  id: string;
  trackingId?: string;
  duration: number;
  eventCount: number;
  frameCount: number;
  encodingStatus: string;
  replayUrl: string;
  videoUrl?: string;
}

/**
 * Per-tab replay metadata sent via CDP event when a tab is destroyed.
 * Allows clients to associate recordings with specific domains/tabs.
 */
export interface TabReplayCompleteParams {
  sessionId: string;
  targetId: TargetId;
  duration: number;
  eventCount: number;
  frameCount: number;
  encodingStatus: string;
  replayUrl: string;
  videoUrl?: string;
}

/**
 * Interface for browsers that support replay event injection.
 *
 * Implemented by ChromiumCDP to enable replay metadata delivery
 * via CDP events before session close.
 */
export interface ReplayCapableBrowser {
  setOnBeforeClose(callback: () => Promise<void>): void;
  sendReplayComplete(metadata: ReplayCompleteParams): Promise<boolean>;
  sendTabReplayComplete(metadata: TabReplayCompleteParams): Promise<boolean>;
}

/**
 * Type guard to check if a browser instance supports replay capabilities.
 */
export function isReplayCapable(browser: unknown): browser is ReplayCapableBrowser {
  return (
    typeof browser === 'object' &&
    browser !== null &&
    'setOnBeforeClose' in browser &&
    typeof (browser as Record<string, unknown>).setOnBeforeClose === 'function' &&
    'sendReplayComplete' in browser &&
    typeof (browser as Record<string, unknown>).sendReplayComplete === 'function' &&
    'sendTabReplayComplete' in browser &&
    typeof (browser as Record<string, unknown>).sendTabReplayComplete === 'function'
  );
}

/**
 * CDP-aware WebSocket proxy that can inject custom events.
 *
 * Unlike http-proxy which creates an opaque tunnel, CDPProxy:
 * 1. Transparently forwards all CDP messages between client and browser
 * 2. Can inject custom CDP events to the client before closing
 * 3. Handles the WebSocket upgrade from the HTTP socket
 *
 * This enables sending replay metadata to clients (like Pydoll)
 * without requiring an additional HTTP call after session close.
 *
 * Flow:
 *   Client <-> CDPProxy <-> Chrome
 *              (can inject events)
 */
/**
 * Timeout in milliseconds for onBeforeClose callback.
 * After this timeout, Browser.close is forwarded to the browser
 * regardless of whether onBeforeClose completed.
 */
const ON_BEFORE_CLOSE_TIMEOUT_MS = 15000;

export class CDPProxy {
  private clientWs: WebSocket | null = null;
  private browserWs: WebSocket | null = null;
  private isClosing = false;
  private closeRequested = false;
  private log = new Logger('cdp-proxy');
  private getTabCount?: () => number;

  /**
   * Debug mode: log all CDP commands going through the proxy.
   * Enable via BROWSERLESS_CDP_DEBUG=1 env var.
   */
  private cdpDebug = !!process.env.BROWSERLESS_CDP_DEBUG;

  constructor(
    private clientSocket: Duplex,
    private clientHead: Buffer,
    private clientRequest: IncomingMessage,
    private browserWsEndpoint: string,
    private config: Config,
    private onClose?: () => void,
    private onBeforeClose?: () => Promise<void>,
    private onEnableCloudflareSolver?: (config: CloudflareConfig) => void,
    private onAddReplayMarker?: (targetId: TargetId, tag: string, payload?: object) => void,
  ) {}

  setGetTabCount(fn: () => number): void {
    this.getTabCount = fn;
  }

  /**
   * Connect to browser and establish bidirectional proxy.
   *
   * CRITICAL: Connect to Chrome FIRST, then upgrade client socket.
   * This ensures no messages are dropped during the connection race.
   */
  async connect(): Promise<void> {
    // Step 1: Connect to Chrome's CDP endpoint FIRST
    await new Promise<void>((resolve, reject) => {
      this.browserWs = new WebSocket(this.browserWsEndpoint);

      this.browserWs.on('open', () => {
        this.log.trace(`Connected to browser: ${this.browserWsEndpoint}`);
        resolve();
      });

      this.browserWs.on('error', (err) => {
        this.log.error(`Browser WebSocket error: ${err.message}`);
        reject(err);
      });
    });

    // Step 2: Now upgrade the client socket (Chrome is ready to receive)
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({ noServer: true });

      wss.handleUpgrade(
        this.clientRequest,
        this.clientSocket,
        this.clientHead,
        (clientWs: WebSocket) => {
          this.clientWs = clientWs;
          this.log.trace('Client WebSocket upgraded');

          // Set up bidirectional proxying
          this.setupProxy();

          // Emit session info to client so they can construct deterministic replay URLs
          const sessionId = this.browserWsEndpoint.split('/').pop() || '';
          if (sessionId) {
            this.emitClientEvent('Browserless.sessionInfo', { sessionId }).catch(() => {});
          }

          clientWs.on('error', (err: Error) => {
            this.log.warn(`Client WebSocket error: ${err.message}`);
            this.handleClose();
          });

          resolve();
        },
      );

      // Handle upgrade failure
      this.clientSocket.on('error', (err) => {
        this.log.error(`Client socket error during upgrade: ${err.message}`);
        this.handleClose();
        reject(err);
      });
    });
  }

  /**
   * Set up bidirectional message forwarding.
   */
  private setupProxy(): void {
    if (!this.clientWs || !this.browserWs) return;

    // Forward client messages to browser
    this.clientWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const raw = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(raw);

          // Intercept Browserless.getSessionInfo — respond with session ID directly
          if (msg?.method === 'Browserless.getSessionInfo' && typeof msg?.id === 'number') {
            const sessionId = this.browserWsEndpoint.split('/').pop() || '';
            void this.sendClientResponse(msg.id, { sessionId });
            return;
          }

          // Gate Browserless.enableCloudflareSolver behind ENABLE_CLOUDFLARE_SOLVER flag
          if (msg?.method === 'Browserless.enableCloudflareSolver' && typeof msg?.id === 'number') {
            if (!this.config.getEnableCloudflareSolver()) {
              void this.sendClientResponse(msg.id, {
                enabled: false,
                error: 'Cloudflare solver is not enabled on this instance',
              });
              return;
            }
            if (this.onEnableCloudflareSolver) {
              const exit = Schema.decodeExit(CloudflareConfig)(msg.params || {}, {
                onExcessProperty: 'ignore',
              });
              if (exit._tag === 'Failure') {
                void this.sendClientResponse(msg.id, {
                  enabled: false,
                  error: `Invalid config: ${exit.cause.toString()}`,
                });
                return;
              }
              this.onEnableCloudflareSolver(exit.value);
            }
            void this.sendClientResponse(msg.id, { enabled: true });
            return;
          }

          // Intercept Browserless.addReplayMarker — inject custom marker into replay
          if (msg?.method === 'Browserless.addReplayMarker' && typeof msg?.id === 'number') {
            if (this.onAddReplayMarker) {
              const { targetId, tag, payload } = msg.params || {};
              if (!tag) {
                void this.sendClientResponse(msg.id, { error: 'tag is required' });
                return;
              }
              this.onAddReplayMarker(targetId || '', tag, payload);
              void this.sendClientResponse(msg.id, { success: true });
            } else {
              void this.sendClientResponse(msg.id, { error: 'Replay not enabled' });
            }
            return;
          }

          // Delay Page.close to flush pending screencast frames + event collection
          if (msg?.method === 'Page.close') {
            setTimeout(() => {
              if (this.browserWs?.readyState === WebSocket.OPEN) {
                this.browserWs.send(data, { binary: isBinary });
              }
            }, 250);
            return;
          }

          // Intercept Browser.close to emit replayComplete before socket closes
          if (msg?.method === 'Browser.close' && this.onBeforeClose && !this.closeRequested) {
            this.closeRequested = true;
            // Run onBeforeClose FIRST (saves replay, emits tabReplayComplete),
            // THEN send the Browser.close response so client WS stays open.
            void this.runBeforeCloseAndForward(data, isBinary, msg?.id);
            return;
          }

          // Reject Target.createTarget when tab count exceeds limit.
          // Sync path: getTabCount callback (from ReplaySession target registry).
          // Async path: queries Chrome's Target.getTargets, must intercept + defer forwarding.
          if (msg?.method === 'Target.createTarget' && typeof msg.id === 'number') {
            const limit = this.config.getMaxTabsPerSession();
            if (limit > 0) {
              if (this.getTabCount) {
                // Sync check — fast path when ReplaySession is tracking targets
                const count = this.getTabCount();
                if (count >= limit) {
                  this.log.warn(`Tab limit reached (${count}/${limit}), rejecting Target.createTarget`);
                  void this.sendClientError(msg.id, -32000, `Tab limit exceeded (${count}/${limit})`);
                  return;
                }
              } else {
                // Async fallback — intercept message, check via CDP, then forward or reject
                void this.checkTabLimitAndForward(msg.id, limit, data, isBinary);
                return;
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      }

      // Debug: log client→browser commands
      if (this.cdpDebug && !isBinary) {
        try {
          const raw = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(raw);
          if (msg.method) {
            const sid = msg.sessionId ? ` [sid=${msg.sessionId.substring(0, 16)}]` : '';
            const params = msg.params ? JSON.stringify(msg.params).substring(0, 200) : '{}';
            this.log.info(`[CDP→Chrome] id=${msg.id} ${msg.method}${sid} ${params}`);
          }
        } catch { /* ignore */ }
      }

      if (this.browserWs?.readyState === WebSocket.OPEN) {
        this.browserWs.send(data, { binary: isBinary });
      }
    });

    // Forward browser messages to client (intercept proxy-injected command responses)
    this.browserWs.on('message', (data, isBinary) => {
      if (!isBinary) {
        try {
          const raw = typeof data === 'string' ? data : data.toString();
          const msg = JSON.parse(raw);
          // Check if this is a response to a proxy-injected command
          if (this.handleProxyResponse(msg)) return; // Don't forward to client

          // Debug: log browser→client events (not responses)
          if (this.cdpDebug && msg.method) {
            const sid = msg.sessionId ? ` [sid=${msg.sessionId.substring(0, 16)}]` : '';
            const params = msg.params ? JSON.stringify(msg.params).substring(0, 150) : '{}';
            this.log.info(`[Chrome→CDP] ${msg.method}${sid} ${params}`);
          }
        } catch { /* ignore parse errors */ }
      }
      if (this.clientWs?.readyState === WebSocket.OPEN) {
        this.clientWs.send(data, { binary: isBinary });
      }
    });

    // Handle close from either side
    this.clientWs.on('close', () => {
      this.log.trace('Client WebSocket closed');
      this.handleClose();
    });

    this.browserWs.on('close', () => {
      this.log.trace('Browser WebSocket closed');
      this.handleClose();
    });
  }

  private async runBeforeCloseAndForward(
    data: WebSocket.RawData,
    isBinary: boolean,
    clientMsgId?: number,
  ): Promise<void> {
    if (this.onBeforeClose) {
      try {
        await Promise.race([
          this.onBeforeClose(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('onBeforeClose timeout')),
              ON_BEFORE_CLOSE_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (e) {
        this.log.warn(
          `onBeforeClose failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    // Send Browser.close response AFTER onBeforeClose (replay events already sent)
    if (typeof clientMsgId === 'number') {
      await this.sendClientResponse(clientMsgId);
    }

    if (this.browserWs?.readyState === WebSocket.OPEN) {
      this.browserWs.send(data, { binary: isBinary });
    }
  }

  private async sendClientResponse(id: number, result: object = {}): Promise<void> {
    if (this.clientWs?.readyState !== WebSocket.OPEN) return;
    const message = JSON.stringify({ id, result });
    await new Promise<void>((resolve, reject) => {
      this.clientWs!.send(message, (err) => {
        if (err) {
          this.log.warn(`Failed to send CDP response id=${id}: ${err.message}`);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  private async sendClientError(id: number, code: number, message: string): Promise<void> {
    if (this.clientWs?.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({ id, error: { code, message } });
    await new Promise<void>((resolve, reject) => {
      this.clientWs!.send(payload, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  /**
   * Async tab limit check: query Chrome for target count, then forward or reject.
   * Used when no sync getTabCount callback is available (no replay session).
   */
  private async checkTabLimitAndForward(
    msgId: number,
    limit: number,
    data: WebSocket.RawData,
    isBinary: boolean,
  ): Promise<void> {
    try {
      const result = await this.sendViaBrowserWs('Target.getTargets', {}, undefined, 5000);
      const targets: Array<{ type: string }> = result?.targetInfos ?? [];
      const count = targets.filter(t => t.type === 'page').length;
      if (count >= limit) {
        this.log.warn(`Tab limit reached (${count}/${limit}), rejecting Target.createTarget`);
        void this.sendClientError(msgId, -32000, `Tab limit exceeded (${count}/${limit})`);
        return;
      }
    } catch (e) {
      // If we can't determine tab count, allow the request through
      this.log.debug(`Tab count check failed, allowing Target.createTarget: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Under limit or check failed — forward to browser
    if (this.browserWs?.readyState === WebSocket.OPEN) {
      this.browserWs.send(data, { binary: isBinary });
    }
  }

  /**
   * Inject a custom CDP event to the client.
   *
   * CDP events are JSON messages with "method" and "params" fields.
   * We use a custom method name "Browserless.replayComplete" that
   * clients (Pydoll) can listen for.
   */
  async emitClientEvent(method: string, params: object): Promise<void> {
    if (this.clientWs?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ method, params });
      // Await the send to ensure message is queued before returning
      await new Promise<void>((resolve, reject) => {
        this.clientWs!.send(message, (err) => {
          if (err) {
            this.log.warn(`Failed to inject CDP event ${method}: ${err.message}`);
            reject(err);
          } else {
            this.log.trace(`Injected CDP event: ${method}`);
            resolve();
          }
        });
      });
    } else {
      this.log.warn(`Cannot inject event ${method}: client WebSocket not open`);
    }
  }

  /**
   * Send a CDP command through the proxy's browser WS.
   */
  private proxyCommandId = 200_000;
  private proxyPendingCommands = new Map<number, { resolve: (result: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  sendViaBrowserWs(method: string, params: object = {}, sessionId?: CdpSessionId, timeoutMs: number = 30_000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.browserWs || this.browserWs.readyState !== WebSocket.OPEN) {
        reject(new Error('Browser WS not open'));
        return;
      }
      const id = this.proxyCommandId++;
      const msg: any = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;

      const timer = setTimeout(() => {
        if (this.proxyPendingCommands.has(id)) {
          this.proxyPendingCommands.delete(id);
          reject(new Error(`CDP proxy command ${method} timed out`));
        }
      }, timeoutMs);
      this.proxyPendingCommands.set(id, { resolve, reject, timer });

      if (this.cdpDebug) {
        const sid = sessionId ? ` [sid=${sessionId.substring(0, 16)}]` : '';
        const p = JSON.stringify(params).substring(0, 200);
        this.log.info(`[SOLVER→Chrome] id=${id} ${method}${sid} ${p}`);
      }

      this.browserWs.send(JSON.stringify(msg));
    });
  }

  /**
   * Create a fresh, isolated WS connection to Chrome — matching pydoll's approach.
   *
   * Pydoll's IFrameContextResolver creates a brand new ConnectionHandler for
   * OOPIF resolution. This fresh WS has ZERO CDP domain enables, no auto-attach,
   * no subscriptions — a completely clean slate. All commands (Target.attachToTarget,
   * DOM queries, Input.dispatchMouseEvent) go through this isolated connection.
   *
   * Returns a sendCommand function scoped to the fresh WS.
   * Call cleanup() when done to close the connection.
   */
  createIsolatedConnection(): { send: (method: string, params?: object, sessionId?: CdpSessionId, timeoutMs?: number) => Promise<any>; cleanup: () => void } {
    const endpoint = this.browserWsEndpoint;
    const ws = new WebSocket(endpoint);
    let cmdId = 300_000;
    const pending = new Map<number, { resolve: (result: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    let connected = false;
    const waitForOpen = new Promise<void>((resolve, reject) => {
      ws.on('open', () => { connected = true; resolve(); });
      ws.on('error', (err) => { if (!connected) reject(err); });
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (typeof msg.id === 'number') {
          const p = pending.get(msg.id);
          if (p) {
            pending.delete(msg.id);
            clearTimeout(p.timer);
            if (msg.error) {
              p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              p.resolve(msg.result);
            }
          }
        }
      } catch { /* ignore */ }
    });

    const send = async (method: string, params: object = {}, sessionId?: string, timeoutMs: number = 30_000): Promise<any> => {
      await waitForOpen;
      return new Promise((resolve, reject) => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Isolated WS not open'));
          return;
        }
        const id = cmdId++;
        const msg: any = { id, method, params };
        if (sessionId) msg.sessionId = sessionId;
        const timer = setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`Isolated CDP command ${method} timed out`));
          }
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify(msg));
      });
    };

    const cleanup = () => {
      for (const [, p] of pending) { clearTimeout(p.timer); }
      pending.clear();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };

    return { send, cleanup };
  }

  /** Handle responses for proxy-injected commands (called from browser WS message handler) */
  private handleProxyResponse(msg: any): boolean {
    if (typeof msg.id !== 'number') return false;
    const pending = this.proxyPendingCommands.get(msg.id);
    if (!pending) return false;
    this.proxyPendingCommands.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    } else {
      pending.resolve(msg.result);
    }
    return true;
  }

  /**
   * Send replay metadata to client before closing.
   *
   * This is the key method that enables zero-delay replay URL delivery.
   * Called by SessionLifecycleManager after stopReplay() returns metadata.
   */
  async sendReplayComplete(metadata: ReplayCompleteParams): Promise<void> {
    await this.emitClientEvent('Browserless.replayComplete', metadata);
    this.log.info(`Sent replay complete event: ${metadata.id}`);
  }

  async sendTabReplayComplete(metadata: TabReplayCompleteParams): Promise<void> {
    await this.emitClientEvent('Browserless.tabReplayComplete', metadata);
    this.log.info(`Sent tab replay complete event: targetId=${metadata.targetId}`);
  }

  /**
   * Close both WebSocket connections.
   */
  private handleClose(): void {
    if (this.isClosing) return;
    this.isClosing = true;

    const clientState = this.clientWs?.readyState;
    const browserState = this.browserWs?.readyState;
    this.log.info(
      `CDPProxy closing: clientWs=${clientState === WebSocket.OPEN ? 'OPEN' : clientState} ` +
      `browserWs=${browserState === WebSocket.OPEN ? 'OPEN' : browserState}`
    );

    // Close client WebSocket
    if (this.clientWs?.readyState === WebSocket.OPEN) {
      this.clientWs.close();
    }
    this.clientWs = null;

    // Close browser WebSocket
    if (this.browserWs?.readyState === WebSocket.OPEN) {
      this.browserWs.close();
    }
    this.browserWs = null;

    this.onClose?.();
  }

  /**
   * Gracefully close the proxy.
   */
  async close(): Promise<void> {
    this.handleClose();
  }

  /**
   * Check if the proxy is still connected.
   */
  isConnected(): boolean {
    return (
      !this.isClosing &&
      this.clientWs?.readyState === WebSocket.OPEN &&
      this.browserWs?.readyState === WebSocket.OPEN
    );
  }
}
