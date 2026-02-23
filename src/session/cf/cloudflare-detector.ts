import { Logger } from '@browserless.io/browserless';
import type { CloudflareConfig, CloudflareInfo, CloudflareType } from '../../shared/cloudflare-detection.js';
import { CloudflareTracker } from './cloudflare-event-emitter.js';
import type { ActiveDetection, CloudflareEventEmitter } from './cloudflare-event-emitter.js';
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

  constructor(
    _sendCommand: SendCommand,
    private events: CloudflareEventEmitter,
    private state: CloudflareStateTracker,
    private strategies: CloudflareSolveStrategies,
  ) {}

  enable(config?: CloudflareConfig): void {
    this.enabled = true;
    if (config) {
      this.state.config = { ...this.state.config, ...config };
      this.events.recordingMarkers = this.state.config.recordingMarkers;
    }
    this.log.info('Cloudflare solver enabled (zero-injection mode)');

    // Check existing pages for CF URLs (no JS injection)
    for (const [targetId, cdpSessionId] of this.state.knownPages) {
      // We don't have URLs for already-attached pages, so fall back to DOM walk
      this.detectTurnstileWidget(targetId, cdpSessionId).catch(() => {});
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Called when a new page target is attached. */
  async onPageAttached(targetId: string, cdpSessionId: string, url: string): Promise<void> {
    this.state.knownPages.set(targetId, cdpSessionId);
    if (!this.enabled || !url || url.startsWith('about:')) return;

    // ZERO-INJECTION: Detect CF from URL pattern only — NO Runtime.evaluate.
    const cfType = this.detectCFFromUrl(url);
    if (cfType) {
      this.triggerSolveFromUrl(targetId, cdpSessionId, url, cfType);
    }
  }

  /** Called when a page navigates. */
  async onPageNavigated(targetId: string, cdpSessionId: string, url: string): Promise<void> {
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

        if (!destinationIsCF) {
          // URL looks clean, but CF may be re-rendering. Check DOM for Turnstile iframe.
          try {
            const detection = await this.strategies.detectTurnstileViaCDP(cdpSessionId);
            if (detection?.present) {
              destinationIsCF = true;
            }
          } catch {
            // CDP error — assume not CF, emit solved
          }
        }

        if (destinationIsCF) {
          this.log.info(`Navigation from ${active.info.type} landed on another CF challenge — suppressing cf.solved`);
          this.events.marker(cdpSessionId, 'cf.rechallenge', {
            type: active.info.type, duration_ms: duration,
            click_delivered: !!active.clickDelivered,
          });
        } else {
          // Distinguish: did our click trigger this navigation, or did CF auto-solve?
          // If clickDelivered is true, our Input.dispatchMouseEvent succeeded and
          // this navigation likely resulted from it.
          const wasClicked = !!active.clickDelivered;
          const clickToNavMs = active.clickDeliveredAt
            ? Date.now() - active.clickDeliveredAt
            : null;

          this.events.emitSolved(active, {
            solved: true,
            type: active.info.type,
            method: wasClicked ? 'click_navigation' : 'auto_navigation',
            signal: 'page_navigated',
            duration_ms: duration,
            attempts: active.attempt,
            auto_resolved: !wasClicked,
          });

          // Extra marker for timing analysis: how long between click and navigation?
          if (wasClicked && clickToNavMs !== null) {
            this.events.marker(cdpSessionId, 'cf.click_to_nav', {
              click_to_nav_ms: clickToNavMs,
              type: active.info.type,
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
    this.detectTurnstileWidget(targetId, cdpSessionId).catch(() => {});
  }

  /** Called when a cross-origin iframe is attached. */
  async onIframeAttached(
    iframeTargetId: string, iframeCdpSessionId: string,
    url: string, parentCdpSessionId: string,
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
      this.state.pendingIframes.set(pageTargetId, { iframeCdpSessionId, iframeTargetId });
      const pageCdpSessionId = this.state.knownPages.get(pageTargetId);
      if (pageCdpSessionId) {
        this.detectTurnstileWidget(pageTargetId, pageCdpSessionId).catch(() => {});
      }
    }
  }

  /** Called when an iframe navigates (Target.targetInfoChanged for type=iframe). */
  async onIframeNavigated(
    iframeTargetId: string, iframeCdpSessionId: string, url: string,
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
      const pageCdpSessionId = this.state.knownPages.get(pageTargetId);
      if (pageCdpSessionId) {
        this.detectTurnstileWidget(pageTargetId, pageCdpSessionId).catch(() => {});
      }
    }
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
    targetId: string, cdpSessionId: string,
    url: string, cfType: CloudflareType,
  ): void {
    if (this.state.destroyed || !this.enabled) return;
    if (this.state.activeDetections.has(targetId)) return;

    const info: CloudflareInfo = {
      type: cfType,
      url,
      detectionMethod: 'url_pattern',
    };

    const active: ActiveDetection = {
      info,
      pageCdpSessionId: cdpSessionId,
      pageTargetId: targetId,
      startTime: Date.now(),
      attempt: 1,
      aborted: false,
      tracker: new CloudflareTracker(info),
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

    this.strategies.solveDetection(active).catch((e) => {
      this.log.debug(`CF solve from URL failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }

  /**
   * Detect standalone Turnstile widgets via CDP DOM walk (zero JS injection).
   * Polls for iframe[src*="challenges.cloudflare.com"] in the page DOM tree.
   */
  private async detectTurnstileWidget(targetId: string, cdpSessionId: string): Promise<void> {
    if (this.state.destroyed || !this.enabled) return;
    if (this.state.activeDetections.has(targetId)) return;

    const startTime = Date.now();

    for (let i = 0; i < 20; i++) {
      if (this.state.destroyed || !this.enabled) return;
      if (this.state.activeDetections.has(targetId)) return;
      if (this.state.bindingSolvedTargets.has(targetId)) return;

      try {
        const detection = await this.strategies.detectTurnstileViaCDP(cdpSessionId);
        if (detection?.present) {
          const info: CloudflareInfo = {
            type: 'turnstile', url: '', detectionMethod: 'cdp_dom_walk',
          };
          const active: ActiveDetection = {
            info, pageCdpSessionId: cdpSessionId, pageTargetId: targetId,
            startTime, attempt: 1, aborted: false,
            tracker: new CloudflareTracker(info),
          };

          // Fast-path: already solved at detection time (auto-solve beat us)
          if (await this.state.isSolved(cdpSessionId) && !this.state.bindingSolvedTargets.has(targetId)) {
            active.aborted = true;
            this.state.bindingSolvedTargets.add(targetId);
            this.events.emitDetected(active);
            this.events.marker(cdpSessionId, 'cf.detected', { type: 'turnstile', method: 'cdp_dom_walk' });
            this.events.emitSolved(active, {
              solved: true, type: 'turnstile', method: 'auto_solve',
              duration_ms: Date.now() - startTime, attempts: 1,
              auto_resolved: true, signal: 'cdp_dom_walk',
            });
            return;
          }

          this.state.activeDetections.set(targetId, active);
          const pending = this.state.pendingIframes.get(targetId);
          if (pending) {
            active.iframeCdpSessionId = pending.iframeCdpSessionId;
            active.iframeTargetId = pending.iframeTargetId;
            this.state.pendingIframes.delete(targetId);
          }
          this.events.emitDetected(active);
          this.events.marker(cdpSessionId, 'cf.detected', { type: 'turnstile', method: 'cdp_dom_walk' });
          await this.strategies.solveDetection(active);
          return;
        }
      } catch {
        // Transient CDP error — keep polling
      }

      await new Promise(r => setTimeout(r, 200));
    }
  }
}
