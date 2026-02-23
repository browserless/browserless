import {
  Logger,
  SessionReplay,
  TabReplayCompleteParams,
} from '@browserless.io/browserless';

import { ScreencastCapture } from './screencast-capture.js';
import { CloudflareSolver } from './cloudflare-solver.js';
import { registerSessionState, tabDuration } from '../prom-metrics.js';
import { TargetRegistry } from './target-state.js';

import type { StopTabRecordingResult } from './replay-coordinator.js';

/**
 * Lifecycle states for a replay session.
 *
 * INITIALIZING: WebSocket connecting, setAutoAttach pending
 * ACTIVE:       Polling events, handling CDP messages
 * DRAINING:     Final event collection in progress (before destroy)
 * DESTROYED:    All resources released
 */
type ReplaySessionState = 'INITIALIZING' | 'ACTIVE' | 'DRAINING' | 'DESTROYED';

export interface ReplaySessionOptions {
  sessionId: string;
  wsEndpoint: string;
  sessionReplay: SessionReplay;
  screencastCapture: ScreencastCapture;
  cloudflareSolver: CloudflareSolver;
  baseUrl: string;
  video?: boolean;
  videosDir?: string;
  onTabReplayComplete?: (metadata: TabReplayCompleteParams) => void;
}

/**
 * ReplaySession encapsulates the full lifecycle of rrweb replay capture
 * for a single browser session.
 *
 * Lifecycle: INITIALIZING → ACTIVE → DRAINING → DESTROYED
 * All three teardown paths (ws close, cleanup, error) converge on destroy().
 */
export class ReplaySession {
  private log = new Logger('replay-session');
  private state: ReplaySessionState = 'INITIALIZING';
  private destroyPromise: Promise<void> | null = null;

  // Options (immutable after construction)
  private readonly sessionId: string;
  private readonly wsEndpoint: string;
  private readonly sessionReplay: SessionReplay;
  private readonly screencastCapture: ScreencastCapture;
  private readonly cloudflareSolver: CloudflareSolver;
  private readonly baseUrl: string;
  private readonly video: boolean;
  private readonly videosDir?: string;
  private readonly onTabReplayComplete?: (metadata: TabReplayCompleteParams) => void;
  private readonly chromePort: string;

  // Unified target state (replaces 9 Maps/Sets)
  private readonly targets = new TargetRegistry();

  // CDP command tracking (not target-specific)
  private readonly pendingCommands = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout>; cdpSessionId?: string }>();

  // Command ID counters
  private cmdId = 1;
  private pageWsCmdId = 100_000;

  // WebSocket (set during initialize)
  private ws: InstanceType<any> | null = null;
  private WebSocket: any = null;
  private unregisterGauges: (() => void) | null = null;

  // Declarative CDP message routing
  private readonly messageHandlers = new Map<string, (msg: any) => Promise<void> | void>();

  constructor(options: ReplaySessionOptions) {
    this.sessionId = options.sessionId;
    this.wsEndpoint = options.wsEndpoint;
    this.sessionReplay = options.sessionReplay;
    this.screencastCapture = options.screencastCapture;
    this.cloudflareSolver = options.cloudflareSolver;
    this.baseUrl = options.baseUrl;
    this.video = options.video ?? false;
    this.videosDir = options.videosDir;
    this.onTabReplayComplete = options.onTabReplayComplete;
    this.chromePort = new URL(options.wsEndpoint).port;
    this.setupMessageRouting();
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Connect to browser WS, enable auto-attach, start polling.
   * Transitions: INITIALIZING → ACTIVE
   */
  async initialize(): Promise<void> {
    this.WebSocket = (await import('ws')).default;
    const ws = new this.WebSocket(this.wsEndpoint);
    this.ws = ws;

    // CRITICAL: Attach error handler synchronously before any async work.
    ws.on('error', (err: Error) => {
      this.log.debug(`Replay WebSocket error: ${err.message}`);
    });

    // Register live data structures for Prometheus gauges.
    // pageWebSockets.size → WS count (via getter), trackedTargets.size → target count
    const targets = this.targets;
    const sessionReplay = this.sessionReplay;
    const sessionId = this.sessionId;
    this.unregisterGauges = registerSessionState({
      pageWebSockets: { get size() { return targets.pageWsCount; } },
      trackedTargets: targets,
      pendingCommands: this.pendingCommands,
      getPagePendingCount: () => targets.getPagePendingCount(),
      getEstimatedBytes: () => sessionReplay.getReplayState(sessionId)?.estimatedBytes ?? 0,
    });

    // Wire up WS message handler
    ws.on('message', (data: Buffer) => this.handleCDPMessage(data));

    // Wire up WS close handler
    ws.on('close', () => this.destroy('ws_close'));

    // Await WebSocket open + setAutoAttach BEFORE returning.
    await new Promise<void>((resolveSetup, rejectSetup) => {
      const setupTimeout = setTimeout(() => {
        rejectSetup(new Error('WebSocket open + setAutoAttach timed out after 10s'));
      }, 10000);

      ws.on('open', async () => {
        try {
          const sendWithRetry = async (method: string, params: object = {}, maxAttempts = 3) => {
            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
              try {
                return await this.sendCommand(method, params);
              } catch (e) {
                if (attempt === maxAttempts) throw e;
                this.log.debug(`CDP ${method} attempt ${attempt} failed, retrying...`);
                await new Promise((r) => setTimeout(r, 1000 * attempt));
              }
            }
          };

          await sendWithRetry('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
          });

          this.log.info(`Target.setAutoAttach succeeded for session ${this.sessionId}`);

          await sendWithRetry('Target.setDiscoverTargets', { discover: true });

          // Initialize screencast capture — only when video=true
          if (this.video && this.videosDir) {
            await this.screencastCapture.initSession(this.sessionId, this.sendCommand.bind(this) as any, this.videosDir);
          }

          this.log.debug(`Replay auto-attach enabled for session ${this.sessionId}`);
          clearTimeout(setupTimeout);
          resolveSetup();
        } catch (e) {
          this.log.warn(`Failed to set up replay: ${e}`);
          clearTimeout(setupTimeout);
          resolveSetup(); // Don't reject — recording setup failure shouldn't block the session
        }
      });
    });

    // No main WS ping/pong — Chrome process death fires WS 'close' event.
    // SessionLifecycleManager handles zombie sessions via TTL.

    // Extension handles rrweb injection — no polling needed.
    // Events arrive via Runtime.addBinding('__rrwebPush') push delivery.

    this.state = 'ACTIVE';
  }

  /**
   * Converged teardown — all three paths (ws_close, cleanup, error) come here.
   * Idempotent via destroyPromise.
   */
  async destroy(source: 'cleanup' | 'ws_close' | 'error'): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;
    this.destroyPromise = this._doDestroy(source);
    return this.destroyPromise;
  }

  private async _doDestroy(source: string): Promise<void> {
    this.state = 'DRAINING';

    // Unregister Prometheus gauges
    this.unregisterGauges?.();

    // Clean up solver
    this.cloudflareSolver.destroy();

    // Finalize all tabs and fire callbacks for ALL destroy sources.
    // 'cleanup': orderly shutdown — collectEvents + stopTabReplay (full finalization).
    // 'ws_close'/'error': Chrome is gone — skip collectEvents, but save in-memory
    //   events via stopTabReplay directly. The replay file will be valid (possibly truncated).
    for (const target of [...this.targets]) {
      try {
        let result: StopTabRecordingResult | null = null;
        if (source === 'cleanup') {
          result = await this.finalizeTab(target.targetId);
        } else {
          // WS close / error: Chrome is gone, but we CAN save in-memory events
          const tabResult = await this.sessionReplay.stopTabReplay(
            this.sessionId, target.targetId
          );
          if (tabResult) {
            const tabReplayId = tabResult.metadata.id;
            result = {
              replayId: tabReplayId,
              duration: tabResult.metadata.duration,
              eventCount: tabResult.metadata.eventCount,
              replayUrl: `${this.baseUrl}/replay/${tabReplayId}`,
              frameCount: 0,
              encodingStatus: 'none',
              videoUrl: '',
            };
          }
        }
        if (this.onTabReplayComplete) {
          const tabReplayId = `${this.sessionId}--tab-${target.targetId}`;
          this.onTabReplayComplete({
            sessionId: this.sessionId,
            targetId: target.targetId,
            duration: result?.duration ?? (Date.now() - target.startTime),
            eventCount: result?.eventCount ?? 0,
            frameCount: result?.frameCount ?? 0,
            encodingStatus: result?.encodingStatus ?? 'none',
            replayUrl: result?.replayUrl ?? `${this.baseUrl}/replay/${tabReplayId}`,
            videoUrl: result?.videoUrl || undefined,
          });
        }
      } catch (e) {
        this.log.warn(`destroy finalize failed for ${target.targetId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Reject all pending browser WS commands
    this.pendingCommands.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error('Session destroyed'));
    });
    this.pendingCommands.clear();

    // Close per-page WebSockets + reject their pending commands
    for (const target of this.targets) {
      if (target.pageWebSocket) {
        const pendingCmds = (target.pageWebSocket as any).__pendingCmds as Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }> | undefined;
        if (pendingCmds) {
          for (const [, { reject, timer }] of pendingCmds) {
            clearTimeout(timer);
            reject(new Error('Session destroyed'));
          }
          pendingCmds.clear();
        }
      }
    }

    // Clear all target state (closes all per-page WSs)
    this.targets.clear();

    // Close main WS (no-op if already closed via ws_close)
    try { this.ws?.close(); } catch {}

    this.state = 'DESTROYED';
    this.log.debug(`ReplaySession destroyed (${source}) for session ${this.sessionId}`);
  }

  /**
   * Final event collection for all tracked targets.
   * Called by registerFinalCollector before replay stop.
   */
  async collectAllEvents(): Promise<void> {
    for (const target of this.targets) {
      // Flush in-page push buffer before collecting remaining events
      try {
        await this.sendCommand('Runtime.evaluate', {
          expression: `(function() {
            var rec = window.__browserlessRecording;
            if (!rec) return;
            if (rec._ft) { clearTimeout(rec._ft); rec._ft = null; }
            if (rec._buf?.length) {
              for (var i = 0; i < rec._buf.length; i++) rec.events.push(rec._buf[i]);
              rec._buf = [];
            }
          })()`,
          returnByValue: true,
        }, target.cdpSessionId);
      } catch {}
      await this.collectEvents(target.targetId);
    }
  }

  // ─── CDP Command Transport ──────────────────────────────────────────────

  /**
   * Send a CDP command and wait for response.
   * Routes Runtime.evaluate through per-page WS when available (zero contention),
   * falls back to browser WS.
   */
  sendCommand(method: string, params: object = {}, cdpSessionId?: string, timeoutMs?: number): Promise<any> {
    if (this.state === 'DESTROYED') {
      return Promise.reject(new Error('Session destroyed'));
    }

    const timeout = timeoutMs ?? 30_000;
    const ws = this.ws;
    const WebSocket = this.WebSocket;

    // Route stateless commands through per-page WS (zero contention on main WS).
    const PAGE_WS_SAFE = method === 'Runtime.evaluate' || method === 'Page.addScriptToEvaluateOnNewDocument';
    if (PAGE_WS_SAFE && cdpSessionId) {
      const target = this.targets.getByCdpSession(cdpSessionId);
      if (target?.pageWebSocket) {
        const pageWs = target.pageWebSocket;
        if (pageWs.readyState === WebSocket.OPEN) {
          return new Promise((resolve, reject) => {
            const id = this.pageWsCmdId++;
            const pendingCmds = (pageWs as any).__pendingCmds as Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>;
            const timer = setTimeout(() => {
              if (pendingCmds.has(id)) {
                pendingCmds.delete(id);
                reject(new Error(`CDP command ${method} timed out (per-page WS)`));
              }
            }, timeout);
            pendingCmds.set(id, { resolve, reject, timer });
            pageWs.send(JSON.stringify({ id, method, params }));
          });
        } else {
          // Dead WS — remove and attempt reconnect (once per target)
          target.pageWebSocket = null;
          if (!target.failedReconnect) {
            this.openPageWebSocket(target.targetId, cdpSessionId)
              .catch(() => { target.failedReconnect = true; });
          }
          // Fall through to browser-level WS
        }
      }
    }

    // Fallback: browser-level WS with sessionId routing
    return new Promise((resolve, reject) => {
      const id = this.cmdId++;
      const msg: any = { id, method, params };
      if (cdpSessionId) {
        msg.sessionId = cdpSessionId;
      }

      const timer = setTimeout(() => {
        if (this.pendingCommands.has(id)) {
          this.pendingCommands.delete(id);
          reject(new Error(`CDP command ${method} timed out`));
        }
      }, timeout);
      this.pendingCommands.set(id, { resolve, reject, timer, cdpSessionId });

      ws!.send(JSON.stringify(msg));
    });
  }

  // ─── Per-page WebSocket ─────────────────────────────────────────────────

  private openPageWebSocket(targetId: string, _cdpSessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const WebSocket = this.WebSocket;
      const pageWsUrl = `ws://127.0.0.1:${this.chromePort}/devtools/page/${targetId}`;
      const pageWs = new WebSocket(pageWsUrl);
      const pendingCmds = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>();
      let settled = false;

      const connectTimer = setTimeout(() => {
        settled = true;
        pageWs.terminate();
        reject(new Error('Per-page WS connect timeout'));
      }, 2_000);

      pageWs.on('open', () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);

        const target = this.targets.getByTarget(targetId);
        if (target) {
          target.pageWebSocket = pageWs;
        }
        (pageWs as any).__pendingCmds = pendingCmds;

        // Keepalive: ping every 30s, close if no pong within 30s.
        // A dead per-page WS is NOT fatal — sendCommand falls back to browser WS.
        const pingInterval = setInterval(() => {
          if (pageWs.readyState !== WebSocket.OPEN) {
            clearInterval(pingInterval);
            return;
          }
          pageWs.ping();
          const pongTimeout = setTimeout(() => {
            this.log.debug(`Per-page WS for ${targetId} missed pong — closing (fallback to browser WS)`);
            pageWs.terminate();
            // No cascade — sendCommand will route through browser WS automatically
          }, 30_000);
          pageWs.once('pong', () => clearTimeout(pongTimeout));
        }, 30_000);

        (pageWs as any).__pingInterval = pingInterval;

        this.log.debug(`Per-page WS opened for target ${targetId}`);
        resolve();
      });

      pageWs.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== undefined) {
            const pending = pendingCmds.get(msg.id);
            if (pending) {
              clearTimeout(pending.timer);
              pendingCmds.delete(msg.id);
              if (msg.error) pending.reject(new Error(msg.error.message));
              else pending.resolve(msg.result);
            }
          }
        } catch {}
      });

      pageWs.on('error', () => { /* silent — fallback to browser WS */ });
      pageWs.on('close', () => {
        const target = this.targets.getByTarget(targetId);
        if (target && target.pageWebSocket === pageWs) {
          target.pageWebSocket = null;
        }
        clearInterval((pageWs as any).__pingInterval);
        for (const [, { reject, timer }] of pendingCmds) {
          clearTimeout(timer);
          reject(new Error('Per-page WS closed'));
        }
        pendingCmds.clear();
      });
    });
  }

  // ─── Event Collection ───────────────────────────────────────────────────

  /**
   * Drain any buffered events from the page's in-memory array.
   * With extension-based injection, events primarily arrive via __rrwebPush binding.
   * This is only called during finalization to collect any stragglers.
   */
  private async collectEvents(targetId: string): Promise<void> {
    if (this.state === 'DESTROYED') return;
    const target = this.targets.getByTarget(targetId);
    if (!target) return;

    try {
      const result = await this.sendCommand('Runtime.evaluate', {
        expression: `(function() {
          const recording = window.__browserlessRecording;
          if (!recording?.events?.length) return JSON.stringify({ events: [] });
          const collected = [...recording.events];
          recording.events = [];
          return JSON.stringify({ events: collected });
        })()`,
        returnByValue: true,
      }, target.cdpSessionId);

      if (result?.result?.value) {
        const { events } = JSON.parse(result.result.value);
        if (events?.length) {
          this.sessionReplay.addTabEvents(this.sessionId, targetId, events);
        }
      }
    } catch {
      // Target may be closed
    }
  }

  // ─── Tab Finalization ───────────────────────────────────────────────────

  private async finalizeTab(targetId: string): Promise<StopTabRecordingResult | null> {
    const target = this.targets.getByTarget(targetId);

    // Prevent double-finalization
    if (target?.finalizedResult) {
      return target.finalizedResult;
    }

    await this.collectEvents(targetId);

    // Stop screencast for this target and get per-tab frame count
    const cdpSid = target?.cdpSessionId;
    let tabFrameCount = 0;
    if (cdpSid && this.video) {
      tabFrameCount = await this.screencastCapture.stopTargetCapture(this.sessionId, cdpSid);
    }

    const tabResult = await this.sessionReplay.stopTabReplay(this.sessionId, targetId, undefined, tabFrameCount);
    if (!tabResult) {
      if (tabFrameCount === 0) {
        this.log.debug(
          `finalizeTab: skipping inactive tab ${targetId}, session ${this.sessionId} (no frames)`
        );
      } else {
        this.log.warn(
          `finalizeTab: stopTabReplay returned null for target ${targetId}, session ${this.sessionId}. ` +
          `isReplaying=${this.sessionReplay.isReplaying(this.sessionId)}, frameCount=${tabFrameCount}`
        );
      }
      return null;
    }

    const tabReplayId = tabResult.metadata.id;
    const result: StopTabRecordingResult = {
      replayId: tabReplayId,
      duration: tabResult.metadata.duration,
      eventCount: tabResult.metadata.eventCount,
      replayUrl: `${this.baseUrl}/replay/${tabReplayId}`,
      frameCount: tabFrameCount,
      encodingStatus: tabResult.metadata.encodingStatus ?? 'none',
      videoUrl: tabFrameCount > 0 ? `${this.baseUrl}/video/${tabReplayId}` : '',
    };

    if (target) {
      target.finalizedResult = result;
    }
    return result;
  }

  // ─── Iframe CDP Event Handling ──────────────────────────────────────────

  private handleIframeCDPEvent(msg: any): void {
    const pageSessionId = this.targets.getParentCdpSession(msg.sessionId);
    if (!pageSessionId) return;
    const parentTargetId = this.targets.findTargetIdByCdpSession(pageSessionId);
    if (!parentTargetId) return;

    // Network.requestWillBeSent → server-side rrweb network.request event
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params?.request;
      this.sessionReplay.addTabEvents(this.sessionId, parentTargetId, [{
        type: 5, timestamp: Date.now(),
        data: {
          tag: 'network.request',
          payload: {
            id: `iframe-${msg.params?.requestId || ''}`,
            url: req?.url || '', method: req?.method || 'GET',
            type: 'iframe', timestamp: Date.now(),
            headers: null, body: null,
          },
        },
      }]);
    }

    // Network.responseReceived → server-side rrweb network.response event
    if (msg.method === 'Network.responseReceived') {
      const resp = msg.params?.response;
      this.sessionReplay.addTabEvents(this.sessionId, parentTargetId, [{
        type: 5, timestamp: Date.now(),
        data: {
          tag: 'network.response',
          payload: {
            id: `iframe-${msg.params?.requestId || ''}`,
            url: resp?.url || '', method: '', status: resp?.status || 0,
            statusText: resp?.statusText || '', duration: 0,
            type: 'iframe', headers: null, body: null,
            contentType: resp?.mimeType || null,
          },
        },
      }]);
    }

    // Runtime.consoleAPICalled → server-side rrweb console plugin event
    if (msg.method === 'Runtime.consoleAPICalled') {
      const level: string = msg.params?.type || 'log';
      const args: string[] = (msg.params?.args || [])
        .map((a: { value?: string; description?: string; type?: string }) =>
          a.value ?? a.description ?? String(a.type))
        .slice(0, 5);
      const trace: string[] = (msg.params?.stackTrace?.callFrames || [])
        .slice(0, 3)
        .map((f: { functionName?: string; url?: string; lineNumber?: number }) =>
          `${f.functionName || '(anonymous)'}@${f.url || ''}:${f.lineNumber ?? 0}`);

      this.sessionReplay.addTabEvents(this.sessionId, parentTargetId, [{
        type: 6, timestamp: Date.now(),
        data: {
          plugin: 'rrweb/console@1',
          payload: { level, payload: args, trace, source: 'iframe' },
        },
      }]);
    }

  }

  // ─── CDP Message Routing ───────────────────────────────────────────────

  private setupMessageRouting(): void {
    this.messageHandlers.set('Target.attachedToTarget', (msg) => this.handleAttachedToTarget(msg));
    this.messageHandlers.set('Target.targetCreated', (msg) => this.handleTargetCreated(msg));
    this.messageHandlers.set('Target.targetDestroyed', (msg) => this.handleTargetDestroyed(msg));
    this.messageHandlers.set('Target.targetInfoChanged', (msg) => this.handleTargetInfoChanged(msg));
  }

  private async handleCDPMessage(data: Buffer): Promise<void> {
    try {
      const msg = JSON.parse(data.toString());

      // Command responses
      if (msg.id !== undefined) {
        const cmd = this.pendingCommands.get(msg.id);
        if (cmd) {
          clearTimeout(cmd.timer);
          this.pendingCommands.delete(msg.id);
          msg.error ? cmd.reject(new Error(msg.error.message)) : cmd.resolve(msg.result);
        }
        return;
      }

      // Iframe CDP events → rrweb recording events
      if (msg.sessionId && this.targets.isIframe(msg.sessionId)) {
        this.handleIframeCDPEvent(msg);
      }

      // Screencast frames
      if (this.video && msg.method === 'Page.screencastFrame' && msg.sessionId) {
        this.screencastCapture.handleFrame(this.sessionId, msg.sessionId, msg.params)
          .catch((e: Error) => this.log.debug(`Screencast frame failed: ${e.message}`));
      }

      // Binding calls (rrweb push, turnstile solved, turnstile target)
      if (msg.method === 'Runtime.bindingCalled') {
        this.handleBindingCalled(msg);
      }

      // Console API calls from page targets — log [browserless-ext] prefixed messages for diagnostics
      if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId && !this.targets.isIframe(msg.sessionId)) {
        const args: string[] = (msg.params?.args || [])
          .map((a: { value?: string; description?: string; type?: string }) =>
            a.value ?? a.description ?? String(a.type))
          .slice(0, 10);
        const text = args.join(' ');
        if (text.includes('[browserless-ext]') || text.includes('[rrweb-diag]')) {
          this.log.info(`[page-console] ${text}`);
        }
      }

      // Routed CDP events
      const handler = this.messageHandlers.get(msg.method);
      if (handler) await handler(msg);
    } catch (e) {
      this.log.debug(`Error processing CDP message: ${e}`);
    }
  }

  private handleBindingCalled(msg: any): void {
    const name = msg.params?.name;
    if (name === '__rrwebPush') {
      try {
        const events = JSON.parse(msg.params.payload);
        const targetId = this.targets.findTargetIdByCdpSession(msg.sessionId);
        if (targetId && events?.length) {
          this.sessionReplay.addTabEvents(this.sessionId, targetId, events);
        }
      } catch {}
    } else if (name === '__turnstileSolvedBinding') {
      this.cloudflareSolver.onAutoSolveBinding(msg.sessionId)
        .catch((e: Error) => this.log.debug(`onAutoSolveBinding failed: ${e.message}`));
    }
  }

  // ─── CDP Event Sub-handlers ─────────────────────────────────────────────

  private async handleAttachedToTarget(msg: any): Promise<void> {
    const { sessionId: cdpSessionId, targetInfo, waitingForDebugger } = msg.params;

    if (targetInfo.type === 'page') {
      this.log.info(`Target attached (paused=${waitingForDebugger}): targetId=${targetInfo.targetId} url=${targetInfo.url} type=${targetInfo.type}`);
      const target = this.targets.add(targetInfo.targetId, cdpSessionId);
      this.cloudflareSolver.onPageAttached(targetInfo.targetId, cdpSessionId, targetInfo.url)
        .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] onPageAttached skipped: ${e.message}`));

      // Eagerly initialize tab event tracking
      this.sessionReplay.addTabEvents(this.sessionId, targetInfo.targetId, []);

      // Extension handles rrweb injection via content_scripts (document_start, world: MAIN).
      // We only need: push binding, session ID, auto-attach for iframes, and resume.
      try {
        // Register push binding so extension can send events without polling
        await this.sendCommand('Runtime.addBinding', { name: '__rrwebPush' }, cdpSessionId);
        await this.sendCommand('Page.enable', {}, cdpSessionId);
        // Enable Runtime domain to receive consoleAPICalled events for diagnostics
        await this.sendCommand('Runtime.enable', {}, cdpSessionId);

        // Set session ID — extension creates __browserlessRecording with empty sessionId
        await this.sendCommand('Runtime.evaluate', {
          expression: `if(window.__browserlessRecording && typeof window.__browserlessRecording === 'object') window.__browserlessRecording.sessionId = '${this.sessionId}';`,
          returnByValue: true,
        }, cdpSessionId).catch(() => {});
        target.injected = true;

        await this.sendCommand('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        }, cdpSessionId);
      } catch (e) {
        this.log.debug(`Target setup failed for ${targetInfo.targetId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Resume the target
      if (waitingForDebugger) {
        await this.sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] runIfWaitingForDebugger skipped: ${e.message}`));
      }

      // Diagnostic probe: check rrweb state 2s after target resumes
      const probeTargetId = targetInfo.targetId;
      const probeCdpSessionId = cdpSessionId;
      setTimeout(async () => {
        try {
          const result = await this.sendCommand('Runtime.evaluate', {
            expression: `JSON.stringify({
              recording: typeof window.__browserlessRecording,
              recValue: window.__browserlessRecording === true ? 'true(iframe)' : (window.__browserlessRecording ? 'object' : 'falsy'),
              stopFn: typeof window.__browserlessStopRecording,
              rrweb: typeof window.rrweb,
              rrwebRecord: typeof (window.rrweb && window.rrweb.record),
              error: (window.__browserlessRecording && window.__browserlessRecording._rrwebError) || null,
              eventCount: window.__browserlessRecording?.events?.length ?? -1,
              bufCount: window.__browserlessRecording?._buf?.length ?? -1,
              body: !!document.body,
              readyState: document.readyState,
            })`,
            returnByValue: true,
          }, probeCdpSessionId);
          this.log.info(`[rrweb-diag] target=${probeTargetId} ${result?.result?.value}`);
        } catch (e) {
          this.log.info(`[rrweb-diag] target=${probeTargetId} probe-failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }, 2000);

      // Start screencast — only when video=true
      if (this.video) {
        this.screencastCapture.addTarget(this.sessionId, this.sendCommand.bind(this) as any, cdpSessionId, targetInfo.targetId)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] screencast addTarget skipped: ${e.message}`));
      }

      // Open per-page WebSocket for zero-contention
      this.openPageWebSocket(targetInfo.targetId, cdpSessionId).catch((err: Error) => {
        this.log.debug(`Per-page WS failed for ${targetInfo.targetId}: ${err.message}`);
      });
    }

    // Cross-origin iframes (e.g., Cloudflare Turnstile)
    // Extension handles rrweb + network + console capture via all_frames: true + world: "MAIN".
    // No CDP domain enables on OOPIF sessions — they're detectable fingerprints.
    // We only need: resume debugger, iframe tracking, CF solver notification.
    if (targetInfo.type === 'iframe') {
      this.log.debug(`Iframe target attached (paused=${waitingForDebugger}): ${targetInfo.targetId} url=${targetInfo.url}`);
      this.targets.addIframeTarget(targetInfo.targetId, cdpSessionId);

      if (waitingForDebugger) {
        await this.sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] iframe runIfWaitingForDebugger skipped: ${e.message}`));
      }

      const parentCdpSid = msg.sessionId || this.getLastPageCdpSession();
      if (parentCdpSid) {
        this.targets.addIframe(cdpSessionId, parentCdpSid);
        this.cloudflareSolver.onIframeAttached(targetInfo.targetId, cdpSessionId, targetInfo.url, parentCdpSid)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] onIframeAttached skipped: ${e.message}`));
      }
    }
  }

  private async handleTargetCreated(msg: any): Promise<void> {
    const { targetInfo } = msg.params;
    if (targetInfo.type === 'page' && !this.targets.has(targetInfo.targetId)) {
      this.log.info(`Discovered external target ${targetInfo.targetId} (url=${targetInfo.url}), attaching...`);
      try {
        await this.sendCommand('Target.attachToTarget', {
          targetId: targetInfo.targetId,
          flatten: true,
        });
      } catch (e) {
        this.log.warn(`Failed to attach to external target ${targetInfo.targetId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private async handleTargetDestroyed(msg: any): Promise<void> {
    const { targetId } = msg.params;

    const target = this.targets.getByTarget(targetId);
    if (target) {
      tabDuration.observe((Date.now() - target.startTime) / 1000);
      const result = await this.finalizeTab(targetId);
      // Always fire callback — even when result is null (no events / stopTabReplay failed).
      // Without this, pydoll's ReplayListener.wait() hangs for the full timeout.
      if (this.onTabReplayComplete) {
        const tabReplayId = `${this.sessionId}--tab-${targetId}`;
        try {
          this.onTabReplayComplete({
            sessionId: this.sessionId,
            targetId,
            duration: result?.duration ?? (Date.now() - target.startTime),
            eventCount: result?.eventCount ?? 0,
            frameCount: result?.frameCount ?? 0,
            encodingStatus: result?.encodingStatus ?? 'none',
            replayUrl: result?.replayUrl ?? `${this.baseUrl}/replay/${tabReplayId}`,
            videoUrl: result?.videoUrl || undefined,
          });
        } catch (e) {
          this.log.warn(`onTabReplayComplete callback failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      // Clean up screencast
      this.screencastCapture.handleTargetDestroyed(this.sessionId, target.cdpSessionId);
    }

    // Atomic cleanup — removes from all indices, closes per-page WS, cleans iframe refs
    this.targets.remove(targetId);
    this.targets.removeIframeTarget(targetId);
  }

  private async handleTargetInfoChanged(msg: any): Promise<void> {
    const { targetInfo } = msg.params;

    if (targetInfo.type === 'page') {
      const target = this.targets.getByTarget(targetInfo.targetId);
      if (target) {
        // Extension handles rrweb re-injection on navigation via content_scripts.
        // We only need to re-enable auto-attach and notify CF solver.
        this.sendCommand('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        }, target.cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] setAutoAttach skipped: ${e.message}`));

        this.cloudflareSolver.onPageNavigated(targetInfo.targetId, target.cdpSessionId, targetInfo.url)
          .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] onPageNavigated skipped: ${e.message}`));
      }
    }

    // Handle iframe navigation
    const iframeCdpSid = this.targets.getIframeCdpSession(targetInfo.targetId);
    if (iframeCdpSid && targetInfo.type === 'iframe') {
      // No CDP domain enables on OOPIF — extension handles capture, enables are fingerprints.
      // Just ensure iframe tracking and notify CF solver.
      if (targetInfo.url?.includes('challenges.cloudflare.com')) {
        if (!this.targets.isIframe(iframeCdpSid)) {
          const fallbackParent = this.getLastPageCdpSession();
          if (fallbackParent) {
            this.targets.addIframe(iframeCdpSid, fallbackParent);
          }
        }
      }

      this.cloudflareSolver.onIframeNavigated(targetInfo.targetId, iframeCdpSid, targetInfo.url)
        .catch((e: Error) => this.log.debug(`[${targetInfo.targetId}] onIframeNavigated skipped: ${e.message}`));
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Get the last known page cdpSessionId (fallback for parent detection). */
  private getLastPageCdpSession(): string | undefined {
    let last: string | undefined;
    for (const target of this.targets) {
      last = target.cdpSessionId;
    }
    return last;
  }

  /**
   * Inject a CF marker directly into the server-side event store.
   * Bypasses Runtime.evaluate — events appear immediately in the replay
   * without needing pollEvents() to drain the page's events array.
   */
  injectMarkerServerSide(cdpSessionId: string, tag: string, payload?: object): void {
    const target = this.targets.getByCdpSession(cdpSessionId);
    if (!target) {
      this.log.warn(`[cf-marker] target not found for cdpSession=${cdpSessionId} tag=${tag} (known=${this.targets.size})`);
      return;
    }
    this.log.info(`[cf-marker] injected tag=${tag} target=${target.targetId}`);
    this.injectMarkerForTarget(target.targetId, tag, payload);
  }

  /**
   * Inject a custom marker by targetId. Used by Browserless.addReplayMarker CDP command.
   * If targetId is empty, injects into the first (usually only) tracked page.
   */
  injectMarkerByTargetId(targetId: string, tag: string, payload?: object): void {
    const resolvedTargetId = targetId || this.targets.firstTargetId();
    if (!resolvedTargetId) {
      this.log.warn(`[replay-marker] no target available for tag=${tag}`);
      return;
    }
    this.injectMarkerForTarget(resolvedTargetId, tag, payload);
  }

  private injectMarkerForTarget(targetId: string, tag: string, payload?: object): void {
    this.sessionReplay.addTabEvents(this.sessionId, targetId, [{
      type: 5,
      timestamp: Date.now(),
      data: { tag, payload: payload || {} },
    }]);
  }

}
