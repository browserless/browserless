import { Logger } from '@browserless.io/browserless';
import type { Latch } from 'effect';
import type { CdpSessionId, TargetId, CloudflareInfo, CloudflareResult, CloudflareSnapshot } from '../../shared/cloudflare-detection.js';

export type EmitClientEvent = (method: string, params: object) => Promise<void>;
export type InjectMarker = (cdpSessionId: CdpSessionId, tag: string, payload?: object) => void;

/**
 * Accumulates state during a CF solve phase.
 * Attached to solved/failed events so clients get a pre-computed summary
 * instead of parsing raw progress events.
 */
export class CloudflareTracker {
  private detectionMethod: string | null;
  private cfCray: string | null;
  private detectionPollCount: number;
  private widgetFound = false;
  private widgetFindMethod: string | null = null;
  private widgetFindMethods: string[] = [];
  private widgetX: number | null = null;
  private widgetY: number | null = null;
  private clicked = false;
  private clickCount = 0;
  private clickX: number | null = null;
  private clickY: number | null = null;
  private presenceDurationMs = 0;
  private presencePhases = 0;
  private approachPhases = 0;
  private activityPollCount = 0;
  private falsePositiveCount = 0;
  private widgetErrorCount = 0;
  private iframeStates: string[] = [];
  private widgetFindDebug: Record<string, any> | null = null;
  private lastErrorType: string | null = null;

  constructor(info: CloudflareInfo) {
    this.detectionMethod = info.detectionMethod;
    this.cfCray = info.cRay || null;
    this.detectionPollCount = info.pollCount || 0;
  }

  onProgress(state: string, extra?: Record<string, any>): void {
    switch (state) {
      case 'widget_found':
        this.widgetFound = true;
        if (extra?.method) {
          this.widgetFindMethods.push(extra.method);
          this.widgetFindMethod = extra.method;
        }
        if (extra?.x != null) this.widgetX = extra.x;
        if (extra?.y != null) this.widgetY = extra.y;
        if (extra?.debug) this.widgetFindDebug = extra.debug;
        break;
      case 'clicked':
        this.clicked = true;
        this.clickCount++;
        if (extra?.x != null) this.clickX = extra.x;
        if (extra?.y != null) this.clickY = extra.y;
        break;
      case 'presence_complete':
        this.presencePhases++;
        if (extra?.presence_duration_ms != null)
          this.presenceDurationMs = extra.presence_duration_ms;
        break;
      case 'approach_complete':
        this.approachPhases++;
        break;
      case 'activity_poll':
        this.activityPollCount++;
        break;
      case 'false_positive':
        this.falsePositiveCount++;
        break;
      case 'widget_error':
        this.widgetErrorCount++;
        if (extra?.error_type) this.lastErrorType = extra.error_type;
        break;
      case 'success':
      case 'verifying':
      case 'fail':
      case 'expired':
      case 'timeout':
        this.iframeStates.push(state);
        break;
    }
  }

  snapshot(): CloudflareSnapshot {
    return {
      detection_method: this.detectionMethod,
      cf_cray: this.cfCray,
      detection_poll_count: this.detectionPollCount,
      widget_found: this.widgetFound,
      widget_find_method: this.widgetFindMethod,
      widget_find_methods: this.widgetFindMethods,
      widget_x: this.widgetX,
      widget_y: this.widgetY,
      clicked: this.clicked,
      click_attempted: this.clicked,
      click_count: this.clickCount,
      click_x: this.clickX,
      click_y: this.clickY,
      presence_duration_ms: this.presenceDurationMs,
      presence_phases: this.presencePhases,
      approach_phases: this.approachPhases,
      activity_poll_count: this.activityPollCount,
      false_positive_count: this.falsePositiveCount,
      widget_error_count: this.widgetErrorCount,
      iframe_states: this.iframeStates,
      widget_find_debug: this.widgetFindDebug,
      widget_error_type: this.lastErrorType,
    };
  }
}

export interface ActiveDetection {
  info: CloudflareInfo;
  pageCdpSessionId: CdpSessionId;
  pageTargetId: TargetId;
  iframeCdpSessionId?: CdpSessionId;
  iframeTargetId?: TargetId;
  startTime: number;
  attempt: number;
  aborted: boolean;
  tracker: CloudflareTracker;
  activityLoopStarted?: boolean;
  /**
   * Set to true ONLY after findAndClickViaCDP() successfully:
   *   1. Found the checkbox via DOM tree walk
   *   2. Confirmed it's visible and interactive
   *   3. Dispatched mousePressed + mouseReleased onto exact coordinates
   * NOT set when no checkbox found, checkbox not visible, or click dispatch failed.
   * Used by deriveSolveAttribution() to determine phase_label (✓ vs →).
   */
  clickDelivered?: boolean;
  /** Timestamp when click was dispatched (for timing analysis). */
  clickDeliveredAt?: number;
  /** Number of CF rechallenges on this target so far. */
  rechallengeCount?: number;
  /**
   * Latch for abort coordination — opens when active.aborted is set to true.
   * Allows Effect fibers to block on `latch.await` instead of polling `aborted`.
   * Initialized closed (not aborted). Open = aborted.
   */
  abortLatch?: Latch.Latch;
}

/** Handles all CDP event emission for Cloudflare detection/solving. */
export class CloudflareEventEmitter {
  private log = new Logger('cf-events');
  recordingMarkers = true;

  constructor(
    private injectMarker: InjectMarker,
    private emitClientEvent: EmitClientEvent = async () => {},
  ) {}

  emitDetected(active: ActiveDetection): void {
    this.emitClientEvent('Browserless.cloudflareDetected', {
      type: active.info.type,
      url: active.info.url,
      iframeUrl: active.info.iframeUrl,
      cRay: active.info.cRay,
      detectionMethod: active.info.detectionMethod,
      pollCount: active.info.pollCount || 1,
      targetId: active.pageTargetId,
    }).catch(() => {});
  }

  emitProgress(active: ActiveDetection, state: string, extra?: Record<string, any>): void {
    active.tracker.onProgress(state, extra);
    this.emitClientEvent('Browserless.cloudflareProgress', {
      state,
      elapsed_ms: Date.now() - active.startTime,
      attempt: active.attempt,
      targetId: active.pageTargetId,
      ...extra,
    }).catch(() => {});
    this.marker(active.pageCdpSessionId, 'cf.state_change', { state, ...extra });
  }

  emitSolved(active: ActiveDetection, result: CloudflareResult): void {
    this.log.info(`CF solved: type=${result.type} method=${result.method} duration=${result.duration_ms}ms`);
    this.emitClientEvent('Browserless.cloudflareSolved', {
      ...result,
      token_length: result.token_length ?? result.token?.length ?? 0,
      targetId: active.pageTargetId,
      summary: active.tracker.snapshot(),
    }).catch(() => {});
    this.marker(active.pageCdpSessionId, 'cf.solved', {
      type: result.type, method: result.method, duration_ms: result.duration_ms,
      phase_label: result.phase_label, signal: result.signal,
    });
  }

  emitFailed(active: ActiveDetection, reason: string, duration: number, phaseLabel?: string): void {
    const phase_label = phaseLabel ?? `✗ ${reason}`;
    this.log.warn(`CF failed: reason=${reason} duration=${duration}ms attempts=${active.attempt}`);
    this.emitClientEvent('Browserless.cloudflareFailed', {
      reason, type: active.info.type, duration_ms: duration, attempts: active.attempt,
      targetId: active.pageTargetId,
      summary: active.tracker.snapshot(),
      phase_label,
    }).catch(() => {});
    this.marker(active.pageCdpSessionId, 'cf.failed', { reason, duration_ms: duration, phase_label });
  }

  emitStandaloneAutoSolved(
    targetId: TargetId,
    signal: string,
    tokenLength: number,
    cdpSessionId?: CdpSessionId,
  ): void {
    const info: CloudflareInfo = {
      type: 'turnstile', url: '', detectionMethod: signal,
    };
    const active: ActiveDetection = {
      info, pageCdpSessionId: cdpSessionId || '' as CdpSessionId, pageTargetId: targetId,
      startTime: Date.now(), attempt: 0, aborted: true,
      tracker: new CloudflareTracker(info),
    };

    this.emitDetected(active);
    if (cdpSessionId) {
      this.marker(cdpSessionId, 'cf.detected', { type: 'turnstile' });
    }
    this.emitSolved(active, {
      solved: true, type: 'turnstile', method: 'auto_solve',
      duration_ms: 0, attempts: 0, auto_resolved: true,
      signal, token_length: tokenLength, phase_label: '→',
    });
  }

  marker(cdpSessionId: CdpSessionId, tag: string, payload?: object): void {
    if (this.recordingMarkers) {
      this.injectMarker(cdpSessionId, tag, payload);
    }
  }
}
