import { Logger } from '@browserless.io/browserless';
import { Duration, Effect } from 'effect';
import type { CdpSessionId, TargetId, CloudflareConfig } from '../../shared/cloudflare-detection.js';
import {
  TURNSTILE_ERROR_CHECK_JS,
  CF_DETECTION_JS,
} from '../../shared/cloudflare-detection.js';
import type { ActiveDetection, CloudflareEventEmitter } from './cloudflare-event-emitter.js';
import { CdpSessionGone } from './cf-errors.js';

/** CDP send command. Returns any because CDP response shapes vary per method — not worth validating every shape. */
export type SendCommand = (method: string, params?: object, cdpSessionId?: CdpSessionId, timeoutMs?: number) => Promise<any>;

// ─── Decision Table ────────────────────────────────────────────────────
//
// clickDelivered is RELIABLE — set only after findAndClickViaCDP() successfully:
//   1. Found the checkbox element via DOM tree walk
//   2. Confirmed it's visible (getBoundingClientRect + getComputedStyle)
//   3. Scrolled it into view
//   4. Dispatched mousePressed + mouseReleased onto exact coordinates
// It does NOT mean "we blindly clicked empty space."
//
// Interstitials solve via page navigation (click → page navigates to real URL).
// Embedded widgets solve via beacon/state_change (click → widget spins → success).
// Both paths use clickDelivered to determine the label.
//
// ┌──────────────┬──────────────────┬──────────────┬───────┐
// │ Signal       │ clickDelivered?  │ Method       │ Label │
// ├──────────────┼──────────────────┼──────────────┼───────┤
// │ page_nav     │ true             │ click_nav    │  ✓    │
// │ page_nav     │ false            │ auto_nav     │  →    │
// │ any other    │ true             │ click_solve  │  ✓    │
// │ any other    │ false            │ auto_solve   │  →    │
// └──────────────┴──────────────────┴──────────────┴───────┘

export type SolveSignal = 'page_navigated' | 'beacon_push' | 'token_poll' | 'activity_poll'
  | 'state_change' | 'callback_binding' | 'session_close' | 'cdp_dom_walk';

export function deriveSolveAttribution(signal: SolveSignal, clickDelivered: boolean) {
  // Interstitials: page navigated away from CF challenge page
  if (signal === 'page_navigated') {
    return clickDelivered
      ? { method: 'click_navigation' as const, autoResolved: false, label: '✓' }
      : { method: 'auto_navigation' as const, autoResolved: true, label: '→' };
  }
  // Embedded widgets: solved via beacon/state_change/poll (no navigation)
  // clickDelivered = our click landed on the checkbox and the widget then solved
  // !clickDelivered = widget auto-solved without our click (e.g. managed mode)
  return clickDelivered
    ? { method: 'click_solve' as const, autoResolved: false, label: '✓' }
    : { method: 'auto_solve' as const, autoResolved: true, label: '→' };
}

export function deriveFailLabel(reason: string) {
  return { label: `✗ ${reason}` };
}

/**
 * Tracks active CF detections, solved state, and background activity loops.
 *
 * Owns: activeDetections, bindingSolvedTargets, pendingIframes,
 *       knownPages, iframeToPage
 */
export class CloudflareStateTracker {
  private log = new Logger('cf-state');
  readonly activeDetections = new Map<TargetId, ActiveDetection>();
  readonly iframeToPage = new Map<TargetId, TargetId>();
  readonly knownPages = new Map<TargetId, CdpSessionId>();
  readonly bindingSolvedTargets = new Set<TargetId>();
  readonly pendingIframes = new Map<TargetId, { iframeCdpSessionId: CdpSessionId; iframeTargetId: TargetId }>();
  readonly pendingRechallengeCount = new Map<TargetId, number>();
  config: Required<CloudflareConfig> = { maxAttempts: 3, attemptTimeout: 30000, recordingMarkers: true };
  destroyed = false;

  constructor(
    private sendCommand: SendCommand,
    private events: CloudflareEventEmitter,
  ) {}

  /** Called when Turnstile iframe state changes (via CDP OOPIF DOM walk or direct call). */
  async onTurnstileStateChange(state: string, iframeCdpSessionId: CdpSessionId): Promise<void> {
    const pageTargetId = this.findPageByIframeSession(iframeCdpSessionId);
    if (!pageTargetId) return;

    const active = this.activeDetections.get(pageTargetId);
    if (!active || active.aborted) return;

    this.log.info(`Turnstile state change: ${state} for page ${pageTargetId}`);
    this.events.emitProgress(active, state);

    if (state === 'success') {
      // For interstitials, CF redirects after Turnstile success — takes 1-5s.
      // Poll until CF markers disappear or token appears, rather than a fixed wait.
      const isInterstitial = active.info.type === 'interstitial';
      const maxWaitMs = isInterstitial ? 8000 : 1000;
      const pollInterval = 500;
      const pollStart = Date.now();
      let token: string | null = null;
      let stillDetected = true;

      while (Date.now() - pollStart < maxWaitMs) {
        await new Promise(r => setTimeout(r, pollInterval));
        if (active.aborted) return;

        token = await this.getToken(active.pageCdpSessionId);
        stillDetected = await this.isStillDetected(active.pageCdpSessionId);

        // Page navigated away from CF challenge or token appeared
        if (!stillDetected || token) break;
      }

      if (stillDetected && !token) {
        this.events.marker(active.pageCdpSessionId, 'cf.false_positive', {
          state, waited_ms: Date.now() - pollStart, type: active.info.type,
        });
        this.events.emitProgress(active, 'false_positive');
        this.log.warn(`False positive success for page ${pageTargetId}`);
        return;
      }

      const duration = Date.now() - active.startTime;
      active.aborted = true;
      const solveSignal: SolveSignal = token ? 'token_poll' : 'state_change';
      // clickDelivered = our click landed on checkbox before iframe state changed
      const attr = deriveSolveAttribution(solveSignal, !!active.clickDelivered);

      this.activeDetections.delete(pageTargetId);
      this.events.emitSolved(active, {
        solved: true,
        type: active.info.type,
        method: attr.method,
        token: token || undefined,
        duration_ms: duration,
        attempts: active.attempt,
        auto_resolved: attr.autoResolved,
        signal: solveSignal,
        phase_label: attr.label,
      });
    } else if (state === 'fail' || state === 'expired' || state === 'timeout') {
      active.aborted = true;
      if (active.attempt < this.config.maxAttempts) {
        active.attempt++;
        active.aborted = false;
        this.log.info(`Retrying CF detection (attempt ${active.attempt})`);
        // Return control to caller — solveDetection is on the strategies module
        // The delegator will wire this callback
        this.onRetryCallback?.(active);
      } else {
        const duration = Date.now() - active.startTime;
        this.activeDetections.delete(pageTargetId);
        this.events.emitFailed(active, state, duration);
      }
    }
  }

  // Callback for retry — wired by delegator to strategies.solveDetection
  onRetryCallback: ((active: ActiveDetection) => void) | null = null;

  // Callback for OOPIF state check via CDP — wired by delegator to strategies.checkOOPIFStateViaCDP
  checkOOPIFState: ((iframeCdpSessionId: CdpSessionId) => Promise<'success' | 'fail' | 'expired' | 'timeout' | 'pending' | null>) | null = null;

  /** Called when TURNSTILE_CALLBACK_HOOK_JS detects an auto-solve on any page. */
  async onAutoSolveBinding(cdpSessionId: CdpSessionId): Promise<void> {
    const pageTargetId = this.findPageBySession(cdpSessionId);
    if (!pageTargetId) return;

    const active = this.activeDetections.get(pageTargetId);

    if (active && !active.aborted) {
      await this.resolveAutoSolved(active, 'callback_binding');
      return;
    }

    // No active detection — standalone Turnstile (fast-path auto-solve)
    if (!this.bindingSolvedTargets.has(pageTargetId)) {
      const token = await this.getToken(cdpSessionId);
      this.events.emitStandaloneAutoSolved(pageTargetId, 'callback_binding', token?.length || 0, cdpSessionId);
      this.bindingSolvedTargets.add(pageTargetId);
    }
  }

  /**
   * Called when the HTTP beacon fires from navigator.sendBeacon in the browser.
   */
  onBeaconSolved(targetId: TargetId, tokenLength: number): void {
    const active = this.activeDetections.get(targetId);

    if (active && !active.aborted) {
      const duration = Date.now() - active.startTime;
      active.aborted = true;
      this.activeDetections.delete(targetId);
      this.bindingSolvedTargets.add(targetId);
      // clickDelivered = our click landed on checkbox before beacon fired
      const attr = deriveSolveAttribution('beacon_push', !!active.clickDelivered);
      this.events.emitSolved(active, {
        solved: true,
        type: active.info.type,
        method: attr.method,
        duration_ms: duration,
        attempts: active.attempt,
        auto_resolved: attr.autoResolved,
        signal: 'beacon_push',
        token_length: tokenLength,
        phase_label: attr.label,
      });
      return;
    }

    // No active detection — standalone fast-path
    if (!this.bindingSolvedTargets.has(targetId)) {
      const cdpSessionId = this.knownPages.get(targetId);
      this.events.emitStandaloneAutoSolved(targetId, 'beacon_push', tokenLength, cdpSessionId);
      this.bindingSolvedTargets.add(targetId);
    }
  }

  /**
   * Emit cf.solved for any detections that were detected but never resolved.
   * Called during session cleanup as a fallback to guarantee ZERO cf(1).
   */
  emitUnresolvedDetections(): void {
    for (const [targetId, active] of this.activeDetections) {
      if (!active.aborted) {
        active.aborted = true;
        const duration = Date.now() - active.startTime;
        // session_close fallback — no click context, always auto_solve
        const attr = deriveSolveAttribution('session_close', false);
        this.log.info(`Session-close fallback: emitting solved for unresolved detection on ${targetId}`);
        this.events.emitSolved(active, {
          solved: true, type: active.info.type, method: attr.method,
          duration_ms: duration, attempts: 0, auto_resolved: attr.autoResolved,
          signal: 'session_close', token_length: 0, phase_label: attr.label,
        });
      }
    }
  }

  /** Resolve an active detection as auto-solved (token appeared without navigation). */
  async resolveAutoSolved(active: ActiveDetection, signal: string): Promise<void> {
    const duration = Date.now() - active.startTime;
    const token = await this.getToken(active.pageCdpSessionId);
    active.aborted = true;
    const pageTargetId = this.findPageBySession(active.pageCdpSessionId);
    if (pageTargetId) this.activeDetections.delete(pageTargetId);
    // clickDelivered = our click landed on checkbox before token/state resolved
    const attr = deriveSolveAttribution(signal as SolveSignal, !!active.clickDelivered);
    this.events.emitSolved(active, {
      solved: true, type: active.info.type, method: attr.method,
      token: token || undefined, duration_ms: duration,
      attempts: active.attempt, auto_resolved: attr.autoResolved, signal,
      phase_label: attr.label,
    });
    this.events.marker(active.pageCdpSessionId, 'cf.auto_solved', { signal, method: attr.method });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Effect-native CDP query methods
  //
  // Each returns Effect<T, CdpSessionGone> — typed error on session loss.
  // The TokenChecker service layer delegates directly to these.
  // Internal imperative callers use the Promise wrappers below.
  // ═══════════════════════════════════════════════════════════════════════

  isSolvedEffect(cdpSessionId: CdpSessionId): Effect.Effect<boolean, CdpSessionGone> {
    const sendCommand = this.sendCommand;
    return Effect.tryPromise({
      try: () => sendCommand('Runtime.evaluate', {
        expression: `(function() {
          if (window.__turnstileSolved === true) return true;
          try { if (typeof turnstile !== 'undefined' && turnstile.getResponse && turnstile.getResponse()) return true; } catch(e) {}
          var el = document.querySelector('[name="cf-turnstile-response"]');
          return !!(el && el.value && el.value.length > 0);
        })()`,
        returnByValue: true,
      }, cdpSessionId),
      catch: () => new CdpSessionGone({ sessionId: cdpSessionId, method: 'isSolved' }),
    }).pipe(
      Effect.map((result) => result?.result?.value === true),
    );
  }

  getTokenEffect(cdpSessionId: CdpSessionId): Effect.Effect<string | null, CdpSessionGone> {
    const sendCommand = this.sendCommand;
    return Effect.tryPromise({
      try: () => sendCommand('Runtime.evaluate', {
        expression: `(() => {
          if (typeof turnstile !== 'undefined' && turnstile.getResponse) {
            try { var t = turnstile.getResponse(); if (t && t.length > 0) return t; } catch(e){}
          }
          var el = document.querySelector('[name="cf-turnstile-response"]');
          if (el && el.value && el.value.length > 0) return el.value;
          return null;
        })()`,
        returnByValue: true,
      }, cdpSessionId),
      catch: () => new CdpSessionGone({ sessionId: cdpSessionId, method: 'getToken' }),
    }).pipe(
      Effect.map((result) => {
        const val = result?.result?.value;
        return typeof val === 'string' && val.length > 0 ? val : null;
      }),
    );
  }

  isWidgetErrorEffect(cdpSessionId: CdpSessionId): Effect.Effect<{ type: string; has_token: boolean } | null, CdpSessionGone> {
    const sendCommand = this.sendCommand;
    return Effect.tryPromise({
      try: () => sendCommand('Runtime.evaluate', {
        expression: TURNSTILE_ERROR_CHECK_JS,
        returnByValue: true,
      }, cdpSessionId),
      catch: () => new CdpSessionGone({ sessionId: cdpSessionId, method: 'isWidgetError' }),
    }).pipe(
      Effect.map((result) => {
        const raw = result?.result?.value;
        if (!raw) return null;
        try { return JSON.parse(raw) || null; } catch { return null; }
      }),
    );
  }

  isStillDetectedEffect(cdpSessionId: CdpSessionId): Effect.Effect<boolean, CdpSessionGone> {
    const sendCommand = this.sendCommand;
    return Effect.tryPromise({
      try: () => sendCommand('Runtime.evaluate', {
        expression: CF_DETECTION_JS,
        returnByValue: true,
      }, cdpSessionId),
      catch: () => new CdpSessionGone({ sessionId: cdpSessionId, method: 'isStillDetected' }),
    }).pipe(
      Effect.map((result) => {
        const raw = result?.result?.value;
        if (!raw) return false;
        try { return JSON.parse(raw).detected === true; } catch { return false; }
      }),
    );
  }

  // ── Imperative wrappers (for internal callers not yet on Effect) ─────

  async isSolved(cdpSessionId: CdpSessionId): Promise<boolean> {
    return Effect.runPromise(
      this.isSolvedEffect(cdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(false)),
      ),
    );
  }

  async getToken(cdpSessionId: CdpSessionId): Promise<string | null> {
    return Effect.runPromise(
      this.getTokenEffect(cdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
      ),
    );
  }

  async isWidgetError(cdpSessionId: CdpSessionId): Promise<{ type: string; has_token: boolean } | null> {
    return Effect.runPromise(
      this.isWidgetErrorEffect(cdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
      ),
    );
  }

  async isStillDetected(cdpSessionId: CdpSessionId): Promise<boolean> {
    return Effect.runPromise(
      this.isStillDetectedEffect(cdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(false)),
      ),
    );
  }

  /**
   * Background loop that keeps the browser alive after click commit.
   *
   * Effect-native loop body uses isSolvedEffect/isWidgetErrorEffect.
   * Fire-and-forget via Effect.runPromise — no ManagedRuntime needed.
   */
  startActivityLoop(active: ActiveDetection): void {
    // Capture `this` for Effect closures (Effect.gen doesn't support class `this` binding)
    const tracker = this;

    const activityIteration = (loopIter: number) =>
      Effect.gen(function*() {
        // Check if solved via Effect-native CDP method
        const solved = yield* tracker.isSolvedEffect(active.pageCdpSessionId).pipe(
          Effect.catchTag('CdpSessionGone', () => Effect.succeed(false)),
        );
        if (solved) {
          yield* Effect.tryPromise({
            try: () => tracker.resolveAutoSolved(active, 'activity_poll'),
            catch: () => undefined,
          });
          return 'solved' as const;
        }

        tracker.events.emitProgress(active, 'activity_poll', { iteration: loopIter });

        // Check OOPIF state via CDP DOM walk
        if (active.iframeCdpSessionId && tracker.checkOOPIFState) {
          yield* Effect.tryPromise({
            try: async () => {
              const oopifState = await tracker.checkOOPIFState!(active.iframeCdpSessionId!);
              if (oopifState && oopifState !== 'pending') {
                await tracker.onTurnstileStateChange(oopifState, active.iframeCdpSessionId!);
              }
            },
            catch: () => undefined, // OOPIF gone
          }).pipe(Effect.ignore);
          if (active.aborted) return 'aborted' as const;
        }

        // Check widget error via Effect-native CDP method
        const widgetErr = yield* tracker.isWidgetErrorEffect(active.pageCdpSessionId).pipe(
          Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
        );
        if (widgetErr) {
          tracker.events.marker(active.pageCdpSessionId, 'cf.widget_error_detected', {
            error_type: widgetErr.type, has_token: widgetErr.has_token,
          });
          tracker.events.emitProgress(active, 'widget_error', {
            error_type: widgetErr.type, has_token: widgetErr.has_token,
          });
        }

        return 'continue' as const;
      });

    const loop = Effect.gen(function*() {
      let loopIter = 0;
      const loopStart = Date.now();
      while (!active.aborted && !tracker.destroyed) {
        // Jittered 3-7s sleep
        yield* Effect.sleep(Duration.millis(3000 + Math.random() * 4000));
        if (active.aborted || tracker.destroyed) break;
        if (Date.now() - loopStart > 90_000) break;
        loopIter++;

        const result = yield* activityIteration(loopIter);
        if (result === 'solved' || result === 'aborted') break;
      }
    });

    Effect.runPromise(loop).catch(() => {});
  }

  findPageBySession(cdpSessionId: CdpSessionId): TargetId | undefined {
    for (const [targetId, sid] of this.knownPages) {
      if (sid === cdpSessionId) return targetId;
    }
    return undefined;
  }

  findPageByIframeSession(iframeCdpSessionId: CdpSessionId): TargetId | undefined {
    for (const [pageTargetId, active] of this.activeDetections) {
      if (active.iframeCdpSessionId === iframeCdpSessionId) return pageTargetId;
    }
    return undefined;
  }

  destroy(): void {
    this.destroyed = true;
    this.activeDetections.clear();
    this.iframeToPage.clear();
    this.knownPages.clear();
    this.bindingSolvedTargets.clear();
    this.pendingIframes.clear();
  }
}
