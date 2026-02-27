import type { CdpSessionId, TargetId } from '../shared/cloudflare-detection.js';
import type { StopTabRecordingResult } from './replay-coordinator.js';

/** All state for a single tracked CDP page target. */
export class TargetState {
  readonly targetId: TargetId;
  readonly cdpSessionId: CdpSessionId;
  readonly startTime = Date.now();
  injected = false;
  finalizedResult: StopTabRecordingResult | null = null;
  pageWebSocket: InstanceType<any> | null = null;
  failedReconnect = false;
  detectionAbort: AbortController | null = null;

  constructor(targetId: TargetId, cdpSessionId: CdpSessionId) {
    this.targetId = targetId;
    this.cdpSessionId = cdpSessionId;
  }
}

/**
 * Unified registry replacing 9 Maps/Sets in ReplaySession.
 *
 * Dual-indexed by targetId and cdpSessionId — eliminates O(n) reverse lookups.
 * Single `remove()` call atomically cleans all references + closes per-page WS.
 */
export class TargetRegistry {
  private readonly byTargetId = new Map<TargetId, TargetState>();
  private readonly byCdpSessionId = new Map<CdpSessionId, TargetState>();

  // Iframe tracking (separate concern — iframes aren't full targets)
  private readonly iframeToCdpSession = new Map<CdpSessionId, CdpSessionId>();       // iframe cdpSid → page cdpSid
  private readonly iframeTargetToCdpSession = new Map<TargetId, CdpSessionId>(); // iframe targetId → iframe cdpSid

  add(targetId: TargetId, cdpSessionId: CdpSessionId): TargetState {
    const state = new TargetState(targetId, cdpSessionId);
    this.byTargetId.set(targetId, state);
    this.byCdpSessionId.set(cdpSessionId, state);
    return state;
  }

  getByTarget(targetId: TargetId): TargetState | undefined {
    return this.byTargetId.get(targetId);
  }

  getByCdpSession(cdpSessionId: CdpSessionId): TargetState | undefined {
    return this.byCdpSessionId.get(cdpSessionId);
  }

  findTargetIdByCdpSession(cdpSessionId: CdpSessionId): TargetId | undefined {
    return this.byCdpSessionId.get(cdpSessionId)?.targetId;
  }

  /** Remove target + close its per-page WS + abort detection + clean iframe refs. One call, no missed Maps. */
  remove(targetId: TargetId): TargetState | undefined {
    const state = this.byTargetId.get(targetId);
    if (!state) return undefined;
    this.byTargetId.delete(targetId);
    this.byCdpSessionId.delete(state.cdpSessionId);
    // Abort detection loop for this target
    if (state.detectionAbort) {
      state.detectionAbort.abort();
      state.detectionAbort = null;
    }
    // Close per-page WS if open (clear ping interval eagerly — close event is async)
    if (state.pageWebSocket) {
      clearInterval((state.pageWebSocket as any).__pingInterval);
      try { state.pageWebSocket.close(); } catch {}
      state.pageWebSocket = null;
    }
    // Clean iframe refs that reference this target's cdpSessionId
    this.iframeToCdpSession.delete(state.cdpSessionId);
    this.iframeTargetToCdpSession.delete(targetId);
    return state;
  }

  has(targetId: TargetId): boolean {
    return this.byTargetId.has(targetId);
  }

  get size(): number {
    return this.byTargetId.size;
  }

  /** Return the first tracked target ID (for default-target resolution). */
  firstTargetId(): TargetId | undefined {
    return this.byTargetId.keys().next().value;
  }

  // ─── Iframe tracking ──────────────────────────────────────────────────

  addIframe(iframeCdpSessionId: CdpSessionId, pageCdpSessionId: CdpSessionId): void {
    this.iframeToCdpSession.set(iframeCdpSessionId, pageCdpSessionId);
  }

  addIframeTarget(iframeTargetId: TargetId, iframeCdpSessionId: CdpSessionId): void {
    this.iframeTargetToCdpSession.set(iframeTargetId, iframeCdpSessionId);
  }

  getParentCdpSession(iframeCdpSessionId: CdpSessionId): CdpSessionId | undefined {
    return this.iframeToCdpSession.get(iframeCdpSessionId);
  }

  getIframeCdpSession(iframeTargetId: TargetId): CdpSessionId | undefined {
    return this.iframeTargetToCdpSession.get(iframeTargetId);
  }

  isIframe(cdpSessionId: CdpSessionId): boolean {
    return this.iframeToCdpSession.has(cdpSessionId);
  }

  removeIframe(cdpSessionId: CdpSessionId): void {
    this.iframeToCdpSession.delete(cdpSessionId);
  }

  removeIframeTarget(targetId: TargetId): void {
    this.iframeTargetToCdpSession.delete(targetId);
  }

  // ─── Prometheus gauge helpers ─────────────────────────────────────────

  /** Count of open per-page WebSockets (for gauge). */
  get openPageWsCount(): number {
    let count = 0;
    for (const state of this.byTargetId.values()) {
      if (state.pageWebSocket?.readyState === 1 /* WebSocket.OPEN */) count++;
    }
    return count;
  }

  /** Total per-page WebSocket count (for gauge). */
  get pageWsCount(): number {
    let count = 0;
    for (const state of this.byTargetId.values()) {
      if (state.pageWebSocket) count++;
    }
    return count;
  }

  /** Sum of all per-page WS pending command counts (for gauge). */
  getPagePendingCount(): number {
    let count = 0;
    for (const state of this.byTargetId.values()) {
      if (state.pageWebSocket) {
        count += (state.pageWebSocket as any).__cdpConn?.pendingCount ?? 0;
      }
    }
    return count;
  }

  // ─── Iteration ────────────────────────────────────────────────────────

  [Symbol.iterator](): Iterator<TargetState> {
    return this.byTargetId.values();
  }

  get targetIds(): Iterable<TargetId> {
    return this.byTargetId.keys();
  }

  values(): IterableIterator<TargetState> {
    return this.byTargetId.values();
  }

  /** Clear all state, abort detection loops, and close all per-page WebSockets. */
  clear(): void {
    for (const state of this.byTargetId.values()) {
      if (state.detectionAbort) {
        state.detectionAbort.abort();
        state.detectionAbort = null;
      }
      if (state.pageWebSocket) {
        clearInterval((state.pageWebSocket as any).__pingInterval);
        try { state.pageWebSocket.close(); } catch {}
      }
    }
    this.byTargetId.clear();
    this.byCdpSessionId.clear();
    this.iframeToCdpSession.clear();
    this.iframeTargetToCdpSession.clear();
  }
}
