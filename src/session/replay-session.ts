import {
  Logger,
  SessionReplay,
  TabReplayCompleteParams,
} from '@browserless.io/browserless';

import type { CdpSessionId, TargetId } from '../shared/cloudflare-detection.js';
import { decodeCDPMessage, decodeRrwebEventBatch } from '../shared/cdp-schemas.js';
import { CdpConnection } from '../shared/cdp-rpc.js';
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

  // CDP command tracking via shared CdpConnection (replaces manual correlation map)
  private browserConn: CdpConnection | null = null;
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
    this.cloudflareSolver.setGetAbortSignal(
      (targetId) => this.targets.getByTarget(targetId)?.detectionAbort?.signal,
    );
    this.setupMessageRouting();
  }

  /** Current number of tracked targets (pages + iframes). */
  getTargetCount(): number {
    return this.targets.size;
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
    const self = this;
    this.unregisterGauges = registerSessionState({
      pageWebSockets: { get size() { return targets.pageWsCount; } },
      trackedTargets: targets,
      pendingCommands: { get size() { return self.browserConn?.pendingCount ?? 0; } },
      getPagePendingCount: () => targets.getPagePendingCount(),
      getEstimatedBytes: () => sessionReplay.getReplayState(sessionId)?.estimatedBytes ?? 0,
    });

    // Create CdpConnection for browser-level WS (replaces manual pendingCommands map)
    this.browserConn = new CdpConnection(ws, { startId: 1, defaultTimeout: 30_000 });

    // Wire up WS message handler
    ws.on('message', (data: Buffer) => this.handleCDPMessage(data));

    // Wire up WS close handler — drain pending commands before destroying
    ws.on('close', () => {
      this.browserConn?.drainPending('ws_close');
      this.destroy('ws_close');
    });

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
    this.log.info(`ReplaySession destroying (${source}) for session ${this.sessionId}, targets=${this.targets.size}`);

    // Unregister Prometheus gauges
    const hadGauges = !!this.unregisterGauges;
    this.unregisterGauges?.();
    this.log.info(`ReplaySession gauges unregistered (had=${hadGauges}) for session ${this.sessionId}`);

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
    this.browserConn?.drainPending('session_destroyed');
    this.browserConn?.dispose();
    this.browserConn = null;

    // Close per-page WebSockets + reject their pending commands via CdpConnection
    for (const target of this.targets) {
      if (target.pageWebSocket) {
        const conn = (target.pageWebSocket as any).__cdpConn as CdpConnection | undefined;
        conn?.drainPending('session_destroyed');
        conn?.dispose();
      }
    }

    // Clear all target state (closes all per-page WSs + clears pending timers)
    this.targets.clear();

    // Close main WS (no-op if already closed via ws_close)
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.unregisterGauges = null;

    this.state = 'DESTROYED';
    this.log.info(`ReplaySession destroyed (${source}) for session ${this.sessionId}`);
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
  sendCommand(method: string, params: object = {}, cdpSessionId?: CdpSessionId, timeoutMs?: number): Promise<any> {
    if (this.state === 'DESTROYED') {
      return Promise.reject(new Error('Session destroyed'));
    }

    const timeout = timeoutMs ?? 30_000;

    // Route stateless commands through per-page WS (zero contention on main WS).
    const PAGE_WS_SAFE = method === 'Runtime.evaluate' || method === 'Page.addScriptToEvaluateOnNewDocument';
    if (PAGE_WS_SAFE && cdpSessionId) {
      const target = this.targets.getByCdpSession(cdpSessionId);
      if (target?.pageWebSocket) {
        const pageWs = target.pageWebSocket;
        if (pageWs.readyState === this.WebSocket.OPEN) {
          const pageConn = (pageWs as any).__cdpConn as CdpConnection | undefined;
          if (pageConn) {
            return pageConn.sendPromise(method, params, undefined, timeout);
          }
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

    // Fallback: browser-level WS with sessionId routing via CdpConnection
    if (!this.browserConn) {
      return Promise.reject(new Error('Browser connection not initialized'));
    }
    return this.browserConn.sendPromise(method, params, cdpSessionId as CdpSessionId | undefined, timeout);
  }

  // ─── Per-page WebSocket ─────────────────────────────────────────────────

  private openPageWebSocket(targetId: TargetId, _cdpSessionId: CdpSessionId): Promise<void> {
    return new Promise((resolve, reject) => {
      const WebSocket = this.WebSocket;
      const pageWsUrl = `ws://127.0.0.1:${this.chromePort}/devtools/page/${targetId}`;
      const pageWs = new WebSocket(pageWsUrl);
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

        // Create CdpConnection for per-page WS (replaces manual __pendingCmds map)
        const pageConn = new CdpConnection(pageWs, {
          startId: this.pageWsCmdId,
          defaultTimeout: 30_000,
        });
        this.pageWsCmdId += 10_000; // Reserve range per page WS
        (pageWs as any).__cdpConn = pageConn;

        // Keepalive: ping every 30s, close if no pong within 30s.
        // A dead per-page WS is NOT fatal — sendCommand falls back to browser WS.
        let activePongTimeout: ReturnType<typeof setTimeout> | undefined;
        const pingInterval = setInterval(() => {
          if (pageWs.readyState !== WebSocket.OPEN) {
            clearInterval(pingInterval);
            return;
          }
          pageWs.ping();
          activePongTimeout = setTimeout(() => {
            activePongTimeout = undefined;
            this.log.debug(`Per-page WS for ${targetId} missed pong — closing (fallback to browser WS)`);
            pageWs.terminate();
          }, 30_000);
          pageWs.once('pong', () => { clearTimeout(activePongTimeout); activePongTimeout = undefined; });
        }, 30_000);

        (pageWs as any).__pingInterval = pingInterval;
        (pageWs as any).__pongTimeout = () => activePongTimeout;

        this.log.debug(`Per-page WS opened for target ${targetId}`);
        resolve();
      });

      pageWs.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          const conn = (pageWs as any).__cdpConn as CdpConnection | undefined;
          conn?.handleResponse(msg);
        } catch {}
      });

      pageWs.on('error', () => { /* silent — fallback to browser WS */ });
      pageWs.on('close', () => {
        const target = this.targets.getByTarget(targetId);
        if (target && target.pageWebSocket === pageWs) {
          target.pageWebSocket = null;
        }
        clearInterval((pageWs as any).__pingInterval);
        // Clear outstanding pong timeout (prevents 30s fire-into-dead-socket)
        const getPongTimeout = (pageWs as any).__pongTimeout as (() => ReturnType<typeof setTimeout> | undefined) | undefined;
        clearTimeout(getPongTimeout?.());
        const conn = (pageWs as any).__cdpConn as CdpConnection | undefined;
        conn?.drainPending('per_page_ws_closed');
        conn?.dispose();
      });
    });
  }

  // ─── Event Collection ───────────────────────────────────────────────────

  /**
   * Drain any buffered events from the page's in-memory array.
   * With extension-based injection, events primarily arrive via __rrwebPush binding.
   * This is only called during finalization to collect any stragglers.
   */
  private async collectEvents(targetId: TargetId): Promise<void> {
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

  private async finalizeTab(targetId: TargetId): Promise<StopTabRecordingResult | null> {
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
    const pageSessionId = this.targets.getParentCdpSession(msg.sessionId as CdpSessionId);
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
    this.messageHandlers.set('Page.frameNavigated', (msg) => this.handleFrameNavigated(msg));
  }

  private async handleCDPMessage(data: Buffer): Promise<void> {
    try {
      const msgExit = decodeCDPMessage(JSON.parse(data.toString()));
      if (msgExit._tag === 'Failure') return; // malformed — skip
      const msg = msgExit.value;

      // Command responses — delegate to CdpConnection
      if (msg.id !== undefined) {
        this.browserConn?.handleResponse(msg);
        return;
      }

      // Iframe CDP events → rrweb recording events
      if (msg.sessionId && this.targets.isIframe(msg.sessionId as CdpSessionId)) {
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
      if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId && !this.targets.isIframe(msg.sessionId as CdpSessionId)) {
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
      if (msg.method) {
        const handler = this.messageHandlers.get(msg.method);
        if (handler) await handler(msg);
      }
    } catch (e) {
      this.log.debug(`Error processing CDP message: ${e}`);
    }
  }

  private handleBindingCalled(msg: any): void {
    const name = msg.params?.name;
    const cdpSessionId = msg.sessionId as CdpSessionId;
    if (name === '__rrwebPush') {
      try {
        const parsed = JSON.parse(msg.params.payload);
        const batchExit = decodeRrwebEventBatch(parsed);
        if (batchExit._tag === 'Failure') return;
        const events = batchExit.value;
        const targetId = this.targets.findTargetIdByCdpSession(cdpSessionId);
        if (targetId && events.length) {
          this.sessionReplay.addTabEvents(this.sessionId, targetId, events as any[]);
        }
      } catch (e) {
        this.log.debug(`rrweb push parse failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (name === '__turnstileSolvedBinding') {
      this.cloudflareSolver.onAutoSolveBinding(cdpSessionId)
        .catch((e: Error) => this.log.debug(`onAutoSolveBinding failed: ${e.message}`));
    }
  }

  // ─── CDP Event Sub-handlers ─────────────────────────────────────────────

  private async handleAttachedToTarget(msg: any): Promise<void> {
    const { sessionId, targetInfo, waitingForDebugger } = msg.params;
    const cdpSessionId = sessionId as CdpSessionId;
    const targetId = targetInfo.targetId as TargetId;

    if (targetInfo.type === 'page') {
      this.log.info(`Target attached (paused=${waitingForDebugger}): targetId=${targetId} url=${targetInfo.url} type=${targetInfo.type}`);
      const target = this.targets.add(targetId, cdpSessionId);
      target.detectionAbort = new AbortController();
      this.cloudflareSolver.onPageAttached(targetId, cdpSessionId, targetInfo.url)
        .catch((e: Error) => this.log.debug(`[${targetId}] onPageAttached skipped: ${e.message}`));

      // Eagerly initialize tab event tracking
      this.sessionReplay.addTabEvents(this.sessionId, targetId, []);

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
        this.log.debug(`Target setup failed for ${targetId}: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Resume the target
      if (waitingForDebugger) {
        await this.sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${targetId}] runIfWaitingForDebugger skipped: ${e.message}`));
      }

      // Diagnostic probe: check rrweb state 2s after target resumes
      const probeTargetId = targetId;
      const probeCdpSessionId = cdpSessionId;
      const probeTimer = setTimeout(async () => {
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
      target.pendingTimers.push(probeTimer);

      // Start screencast — only when video=true
      if (this.video) {
        this.screencastCapture.addTarget(this.sessionId, this.sendCommand.bind(this) as any, cdpSessionId, targetId)
          .catch((e: Error) => this.log.debug(`[${targetId}] screencast addTarget skipped: ${e.message}`));
      }

      // Open per-page WebSocket for zero-contention
      this.openPageWebSocket(targetId, cdpSessionId).catch((err: Error) => {
        this.log.debug(`Per-page WS failed for ${targetId}: ${err.message}`);
      });
    }

    // Cross-origin iframes (e.g., Cloudflare Turnstile)
    // Extension handles rrweb + network + console capture via all_frames: true + world: "MAIN".
    // No CDP domain enables on OOPIF sessions — they're detectable fingerprints.
    // We only need: resume debugger, iframe tracking, CF solver notification.
    if (targetInfo.type === 'iframe') {
      this.log.debug(`Iframe target attached (paused=${waitingForDebugger}): ${targetId} url=${targetInfo.url}`);
      this.targets.addIframeTarget(targetId, cdpSessionId);

      if (waitingForDebugger) {
        await this.sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${targetId}] iframe runIfWaitingForDebugger skipped: ${e.message}`));
      }

      const parentCdpSid = (msg.sessionId as CdpSessionId | undefined) || this.getLastPageCdpSession();
      if (parentCdpSid) {
        this.targets.addIframe(cdpSessionId, parentCdpSid);
        this.cloudflareSolver.onIframeAttached(targetId, cdpSessionId, targetInfo.url, parentCdpSid)
          .catch((e: Error) => this.log.debug(`[${targetId}] onIframeAttached skipped: ${e.message}`));
      }
    }
  }

  private async handleTargetCreated(msg: any): Promise<void> {
    const { targetInfo } = msg.params;
    if (targetInfo.type === 'page' && !this.targets.has(targetInfo.targetId as TargetId)) {
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
    const targetId = msg.params.targetId as TargetId;

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
    const changedTargetId = targetInfo.targetId as TargetId;

    if (targetInfo.type === 'page') {
      const target = this.targets.getByTarget(changedTargetId);
      if (target) {
        // Extension handles rrweb re-injection on navigation via content_scripts.
        // Re-enable CDP domains that Chrome resets on same-target navigation:
        // - Runtime.addBinding: re-register __rrwebPush so new execution context has it
        // - Runtime.enable: required for Runtime.bindingCalled delivery
        // - Page.enable: required for Page.frameNavigated etc.
        // - Target.setAutoAttach: required for new iframe auto-attach
        // Without these, rrweb runs in the new page but events never reach us.
        this.sendCommand('Runtime.addBinding', { name: '__rrwebPush' }, target.cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${changedTargetId}] addBinding skipped: ${e.message}`));
        this.sendCommand('Runtime.enable', {}, target.cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${changedTargetId}] Runtime.enable skipped: ${e.message}`));
        this.sendCommand('Page.enable', {}, target.cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${changedTargetId}] Page.enable skipped: ${e.message}`));
        this.sendCommand('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        }, target.cdpSessionId)
          .catch((e: Error) => this.log.debug(`[${changedTargetId}] setAutoAttach skipped: ${e.message}`));

        this.cloudflareSolver.onPageNavigated(changedTargetId, target.cdpSessionId, targetInfo.url)
          .catch((e: Error) => this.log.debug(`[${changedTargetId}] onPageNavigated skipped: ${e.message}`));
      }
    }

    // Handle iframe navigation
    const iframeCdpSid = this.targets.getIframeCdpSession(changedTargetId);
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

      this.cloudflareSolver.onIframeNavigated(changedTargetId, iframeCdpSid, targetInfo.url)
        .catch((e: Error) => this.log.debug(`[${changedTargetId}] onIframeNavigated skipped: ${e.message}`));
    }
  }

  /**
   * Backup CF detection path via Page.frameNavigated.
   *
   * Target.targetInfoChanged is the primary detection path but doesn't always fire
   * for CF redirects. Page.frameNavigated fires for every navigation and catches
   * the gaps — particularly CF challenges that appear after the initial DOM walk.
   *
   * Uses onPageAttached (detection-only, no resolution) instead of onPageNavigated
   * to avoid aborting detections that targetInfoChanged already started. The
   * detector's internal guard (activeDetections.has) deduplicates automatically.
   */
  private handleFrameNavigated(msg: any): void {
    const frame = msg.params?.frame;
    if (!frame || !msg.sessionId) return;

    // Main frame only — sub-frame navigations are not CF challenge pages
    if (frame.parentId) return;

    const url = frame.url;
    if (!url || url.startsWith('about:') || url.startsWith('chrome:')) return;

    // Only trigger for CF challenge URLs — normal navigations don't need this path
    const isCFUrl = url.includes('__cf_chl_rt_tk=')
      || url.includes('__cf_chl_f_tk=')
      || url.includes('__cf_chl_jschl_tk__=')
      || url.includes('/cdn-cgi/challenge-platform/')
      || url.includes('challenges.cloudflare.com');

    if (!isCFUrl) return;

    const frameCdpSessionId = msg.sessionId as CdpSessionId;
    const target = this.targets.getByCdpSession(frameCdpSessionId);
    if (!target) return;

    // Use onPageAttached (detection-only) — it calls triggerSolveFromUrl which has
    // the activeDetections.has guard for deduplication. Unlike onPageNavigated, it
    // won't abort an existing detection that targetInfoChanged already started.
    this.cloudflareSolver.onPageAttached(target.targetId, frameCdpSessionId, url)
      .catch((e: Error) => this.log.debug(`[${target.targetId}] frameNavigated CF detection skipped: ${e.message}`));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  /** Get the last known page cdpSessionId (fallback for parent detection). */
  private getLastPageCdpSession(): CdpSessionId | undefined {
    let last: CdpSessionId | undefined;
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
  injectMarkerServerSide(cdpSessionId: CdpSessionId, tag: string, payload?: object): void {
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
  injectMarkerByTargetId(targetId: TargetId, tag: string, payload?: object): void {
    const resolvedTargetId = targetId || this.targets.firstTargetId();
    if (!resolvedTargetId) {
      this.log.warn(`[replay-marker] no target available for tag=${tag}`);
      return;
    }
    this.injectMarkerForTarget(resolvedTargetId, tag, payload);
  }

  private injectMarkerForTarget(targetId: TargetId, tag: string, payload?: object): void {
    this.sessionReplay.addTabEvents(this.sessionId, targetId, [{
      type: 5,
      timestamp: Date.now(),
      data: { tag, payload: payload || {} },
    }]);
  }

}
