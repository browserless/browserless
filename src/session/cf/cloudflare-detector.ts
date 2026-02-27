import { Effect } from 'effect';
import { Logger } from '@browserless.io/browserless';
import type { CdpSessionId, TargetId, CloudflareConfig, CloudflareInfo, CloudflareType } from '../../shared/cloudflare-detection.js';
import { DETECTION_POLL_DELAY } from './cf-schedules.js';
import { CloudflareTracker } from './cloudflare-event-emitter.js';
import type { ActiveDetection, CloudflareEventEmitter } from './cloudflare-event-emitter.js';
import { deriveSolveAttribution } from './cloudflare-state-tracker.js';
import type { CloudflareStateTracker, SendCommand } from './cloudflare-state-tracker.js';
import type { CloudflareSolveStrategies } from './cloudflare-solve-strategies.js';

/**
 * Detection lifecycle for Cloudflare challenges.
 *
 * ZERO-INJECTION approach: No Runtime.evaluate, no addScriptToEvaluateOnNewDocument,
 * no Runtime.addBinding on the page. This matches what happens when pydoll's native
 * solver runs (which succeeds) — zero server-side JS execution on the CF page.
 *
 * Detection paths:
 *   1. URL pattern matching — challenges.cloudflare.com in page URL (interstitials)
 *   2. CDP DOM walk — iframe[src*="challenges.cloudflare.com"] (embedded Turnstile)
 *   3. onAutoSolveBinding — instant callback via Runtime.addBinding (handled by state tracker)
 */
export class CloudflareDetector {
  private log = new Logger('cf-detect');
  private enabled = false;
  private startDetectionLoop?: (targetId: TargetId, cdpSessionId: CdpSessionId) => void;

  constructor(
    _sendCommand: SendCommand,
    private events: CloudflareEventEmitter,
    private state: CloudflareStateTracker,
    private strategies: CloudflareSolveStrategies,
  ) {}

  /** Set callback to start a fiber-based detection loop for a target. */
  setStartDetectionLoop(fn: (targetId: TargetId, cdpSessionId: CdpSessionId) => void): void {
    this.startDetectionLoop = fn;
  }

  enable(config?: CloudflareConfig): void {
    this.enabled = true;
    if (config) {
      this.state.config = { ...this.state.config, ...config };
      this.events.recordingMarkers = this.state.config.recordingMarkers;
    }
    this.log.info('Cloudflare solver enabled (zero-injection mode)');

    // Check existing pages for CF URLs (no JS injection)
    for (const [targetId, cdpSessionId] of this.state.knownPages) {
      this.startDetectionLoop?.(targetId, cdpSessionId);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Called when a new page target is attached. */
  async onPageAttached(targetId: TargetId, cdpSessionId: CdpSessionId, url: string): Promise<void> {
    this.state.knownPages.set(targetId, cdpSessionId);
    if (!this.enabled || !url || url.startsWith('about:')) return;

    // ZERO-INJECTION: Detect CF from URL pattern only — NO Runtime.evaluate.
    const cfType = this.detectCFFromUrl(url);
    if (cfType) {
      this.triggerSolveFromUrl(targetId, cdpSessionId, url, cfType);
    }
  }

  /** Called when a page navigates. */
  async onPageNavigated(targetId: TargetId, cdpSessionId: CdpSessionId, url: string): Promise<void> {
    this.state.knownPages.set(targetId, cdpSessionId);

    const active = this.state.activeDetections.get(targetId);
    if (active) {
      active.aborted = true;
      this.state.activeDetections.delete(targetId);
      const duration = Date.now() - active.startTime;

      // For click-based types (interstitial, turnstile, managed), check if the
      // destination is ALSO a CF page before emitting solved/failed.
      // CF rechallenge flow: click → page navigates to clean URL → CF re-serves challenge.
      const clickBased = active.info.type === 'interstitial' || active.info.type === 'turnstile' || active.info.type === 'managed';
      if (clickBased) {
        await new Promise((r) => setTimeout(r, 500));
        let destinationIsCF = !!this.detectCFFromUrl(url);

        // NOTE: We intentionally do NOT DOM-walk for Turnstile iframes here.
        // If the URL is clean, the interstitial solved — even if the destination
        // page has an embedded Turnstile. That's a multi-phase flow (interstitial
        // → embedded widget), not a rechallenge. The embedded Turnstile will be
        // detected by detectTurnstileWidget() in the post-navigation flow below.

        if (destinationIsCF) {
          // TURNSTILE INTERRUPTED BY NAVIGATION — NOT A RECHALLENGE.
          //
          // Rechallenges only apply to interstitials (CF re-serves a challenge
          // after our solve attempt). When a turnstile detection is active and the
          // page navigates to a CF URL, it means the client (pydoll) re-navigated
          // while the embedded turnstile was being solved — the turnstile solve was
          // abandoned, not rechallenged.
          //
          // Example: ahrefs_fast.py's "Fetch interception missed" fallback calls
          // goto() while browserless is solving the embedded Turnstile. CF intercepts
          // the new navigation → URL has __cf_chl_rt_tk → looks like a rechallenge.
          // But the turnstile and the new interstitial are unrelated challenges.
          //
          // Without this guard, the cycle was:
          //   1. detectTurnstileWidget → ActiveDetection(turnstile) → click
          //   2. Pydoll re-navigates → CF intercepts → onPageNavigated sees turnstile + CF URL
          //   3. Rechallenge path: pendingRechallengeCount++ → triggerSolveFromUrl creates
          //      new ActiveDetection(interstitial, rechallengeCount=N)
          //   4. Solved → phantom "Int✓" with inherited rechallenge count
          //   5. detectTurnstileWidget → new turnstile → pydoll re-navs → repeat
          // conversazap.shop showed "Int→Int✓Int✓" (rechallenge_count=2) from this.
          //
          // Fix: discard the turnstile, block further turnstile detection on this
          // tab, and let the new CF URL be detected fresh (no inherited rechallenge).
          if (active.info.type === 'turnstile') {
            this.log.info(`Turnstile detection interrupted by navigation to CF URL — discarding (not a rechallenge)`);
            this.state.bindingSolvedTargets.add(targetId);
            // Fall through to post-navigation URL detection (triggerSolveFromUrl)
          } else {
            const rechallengeCount = (active.rechallengeCount || 0) + 1;
            // label reflects what the attempt DID (✓ = click navigated), not that CF rechallenged
            const rechallengeAttr = deriveSolveAttribution('page_navigated', !!active.clickDelivered);

            this.events.marker(cdpSessionId, 'cf.rechallenge', {
              type: active.info.type, duration_ms: duration,
              click_delivered: !!active.clickDelivered,
              rechallenge_count: rechallengeCount,
            });

            const maxRechallenges = 6;
            if (rechallengeCount >= maxRechallenges) {
              this.log.info(`Rechallenge limit reached (${rechallengeCount}) for ${active.info.type} — emitting cf.failed`);
              this.events.emitFailed(active, 'rechallenge_limit', duration);
              this.state.bindingSolvedTargets.add(targetId);
              return;
            }

            // Label reflects what the attempt did (✓ = click navigated, → = auto navigated),
            // not that it was rechallenged. The rechallenge is a separate concern.
            this.events.emitFailed(active, 'rechallenge', duration, rechallengeAttr.label);

            this.log.info(`Navigation from ${active.info.type} landed on another CF challenge (rechallenge ${rechallengeCount}/${maxRechallenges}) — suppressing cf.solved`);
            this.state.pendingRechallengeCount.set(targetId, rechallengeCount);
          }
        } else {
          // clickDelivered = our click triggered this navigation
          const attr = deriveSolveAttribution('page_navigated', !!active.clickDelivered);
          const clickToNavMs = active.clickDeliveredAt
            ? Date.now() - active.clickDeliveredAt
            : null;

          // BEHAVIORAL RECLASSIFICATION: turnstile → interstitial
          //
          // WHY THIS EXISTS:
          // Some sites (e.g. astrotarot.site) serve CF interstitials on clean URLs — no
          // `__cf_chl_rt_tk`, no `/cdn-cgi/challenge-platform/` path. Our URL-based
          // detection (`detectCFFromUrl`) misses these, so `detectTurnstileViaCDP` picks
          // them up via `Target.getTargets` (which finds the challenges.cloudflare.com
          // iframe) and classifies them as 'turnstile'. But they BEHAVE as interstitials:
          // the page navigates after solve.
          //
          // WHY NOT GET THE TYPE FROM CF DIRECTLY?
          // We investigated every available signal (2026-02-24):
          //
          //   1. `_cf_chl_opt.cType` — CF's gold standard (managed/non_interactive/invisible).
          //      But it requires `Runtime.evaluate` on the page session, which PERMANENTLY
          //      POISONS the session — CF's WASM monitors V8 evaluation events. This is our
          //      #1 CDP safety rule. Using it for classification would break every solve.
          //
          //   2. `Target.getTargets` — returns identical metadata for both interstitial and
          //      embedded (same challenges.cloudflare.com URL, same target structure). There
          //      is no field that distinguishes them.
          //
          //   3. DOM element IDs — CF randomizes them. Nopecha interstitial has IDs like
          //      `CZUq4`, `GeuE4`; astrotarot has zero IDs. No reliable static markers.
          //
          // WHAT DOES DISTINGUISH THEM:
          // Page navigation is the DEFINING behavioral characteristic:
          //   - Interstitials ALWAYS navigate (CF replays the original request after solve)
          //   - Embedded widgets NEVER navigate (they resolve in-place, token goes to form)
          //
          // This is not a hack — it's the only observable signal that doesn't require
          // forbidden CDP calls. The hybrid approach is:
          //   1. URL detection (detectCFFromUrl) catches ~95% of interstitials
          //   2. This reclassification catches the rest (transparent interstitials)
          //
          // WITHOUT THIS: pydoll's _phase_snapshots dict (keyed by cf_type) overwrites
          // the first phase with the second when both are 'turnstile'. Summary shows
          // 'Emb✓' instead of 'Int✓ Emb✓', losing the interstitial phase entirely.
          const emitType = active.info.type === 'turnstile' ? 'interstitial' : active.info.type;

          // DO NOT add bindingSolvedTargets here. After reclassification, the
          // destination page (e.g. Ahrefs) may have a real embedded Turnstile that
          // detectTurnstileWidget (line 248) needs to find. bindingSolvedTargets
          // would block that detection entirely.
          //
          // The phantom loop (conversazap.shop "Int→Int✓Int✓") is prevented by:
          //   1. Turnstile guard in rechallenge path (line 112): if active=turnstile
          //      + destination is CF URL → discard + bindingSolvedTargets (not here)
          //   2. await_resolution in ahrefs_fast.py: waits for CF solve before re-nav
          //   3. onIframeAttached/onIframeNavigated: pendingIframes, no racing detection

          this.events.emitSolved(active, {
            solved: true,
            type: emitType,
            method: attr.method,
            signal: 'page_navigated',
            duration_ms: duration,
            attempts: active.attempt,
            auto_resolved: attr.autoResolved,
            phase_label: attr.label,
          });

          // Extra marker for timing analysis: how long between click and navigation?
          if (attr.method === 'click_navigation' && clickToNavMs !== null) {
            this.events.marker(cdpSessionId, 'cf.click_to_nav', {
              click_to_nav_ms: clickToNavMs,
              type: emitType,
            });
          }
        }
      } else {
        // Non-interactive, invisible — navigation means something else happened
        this.events.emitFailed(active, 'page_navigated', duration);
      }
    }

    if (!this.enabled || !url || url.startsWith('about:')) return;

    // URL-based detection first (instant, zero CDP calls)
    const cfType = this.detectCFFromUrl(url);
    if (cfType) {
      // If we already waited 500ms for click-based rechallenge check above, skip extra delay
      const alreadyWaited = active && (active.info.type === 'interstitial' || active.info.type === 'turnstile' || active.info.type === 'managed');
      if (!alreadyWaited) {
        await new Promise((r) => setTimeout(r, 500));
      }
      this.triggerSolveFromUrl(targetId, cdpSessionId, url, cfType);
      return;
    }

    // Not a CF URL — check for embedded Turnstile via DOM walk (zero JS injection)
    const alreadyWaited = active && (active.info.type === 'interstitial' || active.info.type === 'turnstile' || active.info.type === 'managed');
    if (!alreadyWaited) {
      await new Promise((r) => setTimeout(r, 500));
    }
    this.startDetectionLoop?.(targetId, cdpSessionId);
  }

  /** Called when a cross-origin iframe is attached. */
  async onIframeAttached(
    iframeTargetId: TargetId, iframeCdpSessionId: CdpSessionId,
    url: string, parentCdpSessionId: CdpSessionId,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!url?.includes('challenges.cloudflare.com')) return;

    const pageTargetId = this.state.findPageBySession(parentCdpSessionId);
    if (!pageTargetId) return;

    this.state.iframeToPage.set(iframeTargetId, pageTargetId);

    const active = this.state.activeDetections.get(pageTargetId);
    if (active) {
      active.iframeCdpSessionId = iframeCdpSessionId;
      active.iframeTargetId = iframeTargetId;
    } else {
      // Store iframe as pending — triggerSolveFromUrl or onPageNavigated's
      // detectTurnstileWidget will pick it up. Do NOT start detectTurnstileWidget
      // here: it races with triggerSolveFromUrl creating duplicate parallel solves
      // (both detected at +0.0s, interstitial orphaned → no_resolution).
      this.state.pendingIframes.set(pageTargetId, { iframeCdpSessionId, iframeTargetId });
    }
  }

  /** Called when an iframe navigates (Target.targetInfoChanged for type=iframe). */
  async onIframeNavigated(
    iframeTargetId: TargetId, iframeCdpSessionId: CdpSessionId, url: string,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!url?.includes('challenges.cloudflare.com')) return;

    const pageTargetId = this.state.iframeToPage.get(iframeTargetId);
    if (!pageTargetId) return;

    const active = this.state.activeDetections.get(pageTargetId);
    if (active && !active.iframeCdpSessionId) {
      active.iframeCdpSessionId = iframeCdpSessionId;
      active.iframeTargetId = iframeTargetId;
    } else if (!active) {
      // Same race as onIframeAttached: if onPageNavigated hasn't fired yet,
      // there's no active detection, but triggerSolveFromUrl is about to create one.
      // Starting detectTurnstileWidget here races with it → dual detection → orphan.
      // Store as pending instead — triggerSolveFromUrl/detectTurnstileWidget will pick it up.
      this.state.pendingIframes.set(pageTargetId, { iframeCdpSessionId, iframeTargetId });
    }
  }

  private emitSolveFailure(active: ActiveDetection, targetId: TargetId, reason: string): void {
    if (active.aborted) return;
    this.events.emitFailed(active, reason, Date.now() - active.startTime);
    active.aborted = true;
    this.state.activeDetections.delete(targetId);
  }

  // ─── Private detection methods ──────────────────────────────────────

  /**
   * Detect CF challenge type purely from URL pattern. Zero CDP calls.
   *
   * CF interstitial challenge pages are served on the TARGET domain's URL
   * (e.g. nopecha.com/demo/cloudflare?__cf_chl_rt_tk=...). The
   * challenges.cloudflare.com domain only appears in the Turnstile iframe.
   *
   * Detection signals:
   * - __cf_chl_rt_tk query param = CF challenge retry token
   * - __cf_chl_f_tk query param = CF challenge form token
   * - __cf_chl_jschl_tk__ query param = legacy CF JS challenge token
   * - /cdn-cgi/challenge-platform/ in pathname
   * - challenges.cloudflare.com hostname (rare — direct challenge URLs)
   */
  private detectCFFromUrl(url: string): CloudflareType | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      // CF interstitial challenge pages
      if (parsed.hostname === 'challenges.cloudflare.com') return 'interstitial';
      // CF challenge platform paths
      if (parsed.pathname.includes('/cdn-cgi/challenge-platform/')) return 'interstitial';
      // CF challenge retry/form tokens in query params
      if (parsed.search.includes('__cf_chl_rt_tk=')) return 'interstitial';
      if (parsed.search.includes('__cf_chl_f_tk=')) return 'interstitial';
      if (parsed.search.includes('__cf_chl_jschl_tk__=')) return 'interstitial';
    } catch {
      // Not a valid URL — check raw string patterns
      if (url.includes('challenges.cloudflare.com')) return 'interstitial';
      if (url.includes('__cf_chl_rt_tk=')) return 'interstitial';
    }
    return null;
  }

  /**
   * Trigger solve from URL-based detection. No Runtime.evaluate needed.
   */
  private triggerSolveFromUrl(
    targetId: TargetId, cdpSessionId: CdpSessionId,
    url: string, cfType: CloudflareType,
  ): void {
    if (this.state.destroyed || !this.enabled) return;
    if (this.state.activeDetections.has(targetId)) {
      this.log.info(`triggerSolveFromUrl: SKIPPED — activeDetection already exists for ${targetId} (type=${this.state.activeDetections.get(targetId)!.info.type})`);
      return;
    }
    if (this.state.bindingSolvedTargets.has(targetId)) return;

    const info: CloudflareInfo = {
      type: cfType,
      url,
      detectionMethod: 'url_pattern',
    };

    const rechallengeCount = this.state.pendingRechallengeCount.get(targetId) || 0;
    this.state.pendingRechallengeCount.delete(targetId);

    const active: ActiveDetection = {
      info,
      pageCdpSessionId: cdpSessionId,
      pageTargetId: targetId,
      startTime: Date.now(),
      attempt: 1,
      aborted: false,
      tracker: new CloudflareTracker(info),
      rechallengeCount,
    };

    this.state.activeDetections.set(targetId, active);
    const pending = this.state.pendingIframes.get(targetId);
    if (pending) {
      active.iframeCdpSessionId = pending.iframeCdpSessionId;
      active.iframeTargetId = pending.iframeTargetId;
      this.state.pendingIframes.delete(targetId);
    }
    this.events.emitDetected(active);
    this.events.marker(cdpSessionId, 'cf.detected', { type: cfType, method: 'url_pattern' });

    this.strategies.solveDetection(active).then((outcome) => {
      if (outcome === 'no_click') {
        this.emitSolveFailure(active, targetId, 'widget_not_found');
      }
    }).catch((e) => {
      this.log.debug(`CF solve from URL failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * Effect-based Turnstile detection loop.
   *
   * Polls for iframe[src*="challenges.cloudflare.com"] via CDP DOM walk.
   * Runs until interrupted (fiber cancellation replaces AbortSignal).
   * Under load, each Target.getTargets call may take up to 5s (reduced timeout),
   * but the loop retries indefinitely until the fiber is interrupted.
   */
  detectTurnstileWidgetEffect(targetId: TargetId, cdpSessionId: CdpSessionId): Effect.Effect<void> {
    const self = this;
    return Effect.fn('cf.detectTurnstileWidget')(function*() {
      if (self.state.destroyed || !self.enabled) return;
      if (self.state.activeDetections.has(targetId)) return;

      const startTime = Date.now();

      while (true) {
        if (self.state.destroyed || !self.enabled) return;
        if (self.state.activeDetections.has(targetId)) return;
        if (self.state.bindingSolvedTargets.has(targetId)) return;

        const detection = yield* Effect.tryPromise(
          () => self.strategies.detectTurnstileViaCDP(cdpSessionId),
        ).pipe(Effect.orElseSucceed(() => null));

        if (detection?.present) {
          yield* Effect.tryPromise(
            () => self.handleTurnstileDetection(targetId, cdpSessionId, detection, startTime),
          ).pipe(Effect.orElseSucceed(() => undefined));
          return;
        }

        yield* Effect.sleep(DETECTION_POLL_DELAY);
      }
    })();
  }

  /**
   * Handle a positive Turnstile detection — create ActiveDetection, emit events, start solve.
   * Extracted from detectTurnstileWidget for clarity.
   */
  private async handleTurnstileDetection(
    targetId: TargetId,
    cdpSessionId: CdpSessionId,
    detection: { present: boolean; cfType?: CloudflareType; cRay?: string },
    startTime: number,
  ): Promise<void> {
    const rechallengeCount = this.state.pendingRechallengeCount.get(targetId) || 0;
    this.state.pendingRechallengeCount.delete(targetId);

    const cfType = detection.cfType ?? 'turnstile';
    const info: CloudflareInfo = {
      type: cfType, url: '', detectionMethod: 'cdp_dom_walk',
      cRay: detection.cRay,
    };
    const active: ActiveDetection = {
      info, pageCdpSessionId: cdpSessionId, pageTargetId: targetId,
      startTime, attempt: 1, aborted: false,
      tracker: new CloudflareTracker(info),
      rechallengeCount,
    };

    // Guard: another detection path (e.g. triggerSolveFromUrl) may have
    // registered while we awaited the CDP call. Check before every async gap.
    if (this.state.activeDetections.has(targetId)) return;

    // NOTE: Do NOT call isSolved() here — it uses Runtime.evaluate on the
    // page session, which triggers CF's WASM V8 detection and causes
    // rechallenges. The bindingSolvedTargets check is in the caller loop.

    this.state.activeDetections.set(targetId, active);
    const pending = this.state.pendingIframes.get(targetId);
    if (pending) {
      active.iframeCdpSessionId = pending.iframeCdpSessionId;
      active.iframeTargetId = pending.iframeTargetId;
      this.state.pendingIframes.delete(targetId);
    }
    this.events.emitDetected(active);
    this.events.marker(cdpSessionId, 'cf.detected', { type: cfType, method: 'cdp_dom_walk' });
    const outcome = await this.strategies.solveDetection(active);
    if (outcome === 'no_click') {
      this.emitSolveFailure(active, targetId, 'widget_not_found');
    }
  }
}
