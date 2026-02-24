import {
  simulateHumanPresence,
} from '../../shared/mouse-humanizer.js';
import type { CloudflareType } from '../../shared/cloudflare-detection.js';
import type { ActiveDetection, CloudflareEventEmitter } from './cloudflare-event-emitter.js';
import type { CloudflareStateTracker, SendCommand } from './cloudflare-state-tracker.js';

/** Result from detectTurnstileViaCDP — includes type info when available. */
export interface CFDetectionResult {
  present: boolean;
  cfType?: CloudflareType;
  cRay?: string;
}

export type SolveOutcome =
  | 'click_dispatched'
  | 'no_click'
  | 'auto_handled'
  | 'aborted';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Cloudflare's well-known test sitekey prefixes.
 * These appear in the OOPIF URL path and always auto-pass/block — skip them.
 *   1x00... = always passes (visible)
 *   2x00... = always blocks (visible)
 *   3x00... = always passes (invisible/managed)
 * Ref: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 */
const CF_TEST_SITEKEY_PREFIXES = ['1x00000000', '2x00000000', '3x00000000'];

/** Returns true if the OOPIF URL contains a CF test sitekey. */
function isCFTestWidget(url: string | undefined): boolean {
  if (!url) return false;
  return CF_TEST_SITEKEY_PREFIXES.some((prefix) => url.includes(prefix));
}

function assertNever(x: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${x}`);
}

/** CDP DOM node shape (subset of fields we use). */
interface CDPNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue?: string;
  children?: CDPNode[];
  shadowRoots?: CDPNode[];
  attributes?: string[];
  contentDocument?: CDPNode;
  frameId?: string;
}

/**
 * Solve execution strategies for Cloudflare challenges.
 *
 * Uses pure CDP commands for shadow DOM traversal and trusted OOPIF clicks:
 * - DOM.getDocument(depth=-1, pierce=true) for shadow DOM discovery
 * - Input.dispatchMouseEvent through iframeCdpSessionId for isTrusted:true clicks
 */
export class CloudflareSolveStrategies {
  /**
   * Optional proxy-routed sendCommand (through CDPProxy's browserWs).
   */
  private sendViaProxy: SendCommand | null = null;

  constructor(
    private sendCommand: SendCommand,
    private events: CloudflareEventEmitter,
    private state: CloudflareStateTracker,
    private chromePort?: string,
  ) {}

  setSendViaProxy(fn: SendCommand): void {
    this.sendViaProxy = fn;
  }

  async solveDetection(active: ActiveDetection): Promise<SolveOutcome> {
    if (active.aborted || this.state.destroyed) return 'aborted';

    try {
      switch (active.info.type) {
        case 'managed':
        case 'interstitial': {
          const presence = active.info.type === 'managed'
            ? 0.5 + Math.random() * 1.0
            : 1.5 + Math.random() * 1.5;
          const clicked = await this.solveByClicking(active, presence);
          return active.aborted ? 'aborted' : clicked ? 'click_dispatched' : 'no_click';
        }
        case 'turnstile': {
          const clicked = await this.solveTurnstile(active);
          return active.aborted ? 'aborted' : clicked ? 'click_dispatched' : 'no_click';
        }
        case 'non_interactive':
        case 'invisible':
          await this.solveAutomatic(active);
          return active.aborted ? 'aborted' : 'auto_handled';
        case 'block':
          throw new Error('block type should not reach solveDetection');
        default:
          assertNever(active.info.type, 'CloudflareType in solveDetection');
      }
    } catch (err) {
      if (!active.aborted) {
        this.events.emitFailed(active, 'solve_exception', Date.now() - active.startTime);
        active.aborted = true;
        this.state.activeDetections.delete(active.pageTargetId);
      }
      return 'aborted';
    }
  }

  /**
   * Click-based solve for managed and interstitial types.
   * ZERO-INJECTION: No Runtime.evaluate on the page before clicking.
   * Matches pydoll's approach: immediate Phase 1 polling → find OOPIF → click.
   */
  private async solveByClicking(active: ActiveDetection, _presenceDuration: number): Promise<boolean> {
    if (active.aborted) return false;

    const maxAttempts = 6;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (active.aborted) return false;

      if (attempt > 0) await sleep(500);

      const result = await this.findAndClickViaCDP(active, attempt);
      if (result) {
        this.events.emitProgress(active, 'cdp_click_complete', { success: true, attempt });
        return true;
      }
    }

    this.events.emitProgress(active, 'cdp_click_complete', { success: false, attempts: maxAttempts });
    return false;
  }

  /**
   * Solve standalone Turnstile widgets on third-party pages.
   * ZERO-INJECTION: No Runtime.evaluate on the page before clicking.
   *
   * After click attempts, waits for auto-solve by polling turnstile.getResponse().
   * This handles non-interactive widgets (Ahrefs) that auto-solve without clicking.
   * Runtime.evaluate is safe AFTER detection — CF's WASM checks run during detection,
   * not during post-click polling.
   */
  private async solveTurnstile(active: ActiveDetection): Promise<boolean> {
    if (active.aborted) return false;
    const { pageCdpSessionId } = active;
    const deadline = Date.now() + 30_000;

    // Phase 1: Try to click the checkbox
    const maxAttempts = 6;
    let clicked = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (active.aborted || Date.now() > deadline) return false;

      if (attempt > 0) await sleep(500);

      const result = await this.findAndClickViaCDP(active, attempt);
      if (result) {
        this.events.emitProgress(active, 'cdp_click_complete', { success: true, attempt });
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      this.events.emitProgress(active, 'cdp_click_complete', { success: false, attempts: maxAttempts });
      this.events.marker(pageCdpSessionId, 'cf.cdp_no_checkbox');
    }

    // Phase 2: Wait for auto-solve (token via turnstile.getResponse()).
    // Covers both: click succeeded and we wait for token, or click failed and
    // the widget is non-interactive (auto-solves without click).
    while (!active.aborted && Date.now() < deadline) {
      await sleep(500);
      if (active.aborted) return false;

      try {
        const token = await this.state.getToken(pageCdpSessionId);
        if (token) {
          this.events.marker(pageCdpSessionId, 'cf.token_polled', { token_length: token.length });
          // Resolve via state tracker so the event pipeline fires correctly
          await this.state.resolveAutoSolved(active, 'token_poll');
          return true;
        }
      } catch {
        // CDP error — page may have navigated (click solved it)
      }

      // Also check if something else resolved it (beacon, navigation)
      if (active.aborted) return false;
    }

    return clicked;
  }

  /**
   * Auto-solve for non_interactive and invisible types.
   */
  private async solveAutomatic(active: ActiveDetection): Promise<void> {
    if (active.aborted) return;
    this.events.marker(active.pageCdpSessionId, 'cf.presence_start', { type: active.info.type });
    await simulateHumanPresence(this.sendCommand, active.pageCdpSessionId, 2.0 + Math.random() * 2.0);
  }

  // ── Runtime.callFunctionOn Element Finding (matches pydoll) ─────────

  /**
   * Find the Turnstile checkbox using a specific sendCommand function.
   * This allows routing ALL commands through the same WS connection
   * (critical because CDP session IDs are per-connection).
   */
  private async findCheckboxViaRuntimeUsing(
    send: SendCommand,
    oopifSessionId: string,
  ): Promise<{ objectId: string; backendNodeId: number } | null> {
    try {
      // Step 1: Get document node
      const doc = await send('DOM.getDocument', {
        depth: 0,
      }, oopifSessionId);
      if (!doc?.root) return null;

      // Step 2: Resolve document to get its objectId
      const resolved = await send('DOM.resolveNode', {
        nodeId: doc.root.nodeId,
      }, oopifSessionId);
      if (!resolved?.object?.objectId) return null;

      // Step 3: Find body element via Runtime.callFunctionOn
      const bodyResult = await send('Runtime.callFunctionOn', {
        objectId: resolved.object.objectId,
        functionDeclaration: `function() { return this.querySelector('body'); }`,
        returnByValue: false,
      }, oopifSessionId);
      if (!bodyResult?.result?.objectId) return null;

      // Step 4: Describe body node with pierce=true to get shadow root
      const bodyDesc = await send('DOM.describeNode', {
        objectId: bodyResult.result.objectId,
        pierce: true,
        depth: 1,
      }, oopifSessionId);

      // The Turnstile checkbox is inside a shadow root on the body or a child.
      // Walk shadow roots to find the one containing span.cb-i.
      const shadowRoots = bodyDesc?.node?.shadowRoots;

      if (shadowRoots?.length) {
        // Try each shadow root
        for (const sr of shadowRoots) {
          const found = await this.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
          if (found) return found;
        }
      }

      // If no shadow roots on body, search children for shadow hosts
      // (Turnstile might nest the shadow root one level deeper)
      const children = bodyDesc?.node?.children;
      if (children?.length) {
        for (const child of children) {
          const childDesc = await send('DOM.describeNode', {
            backendNodeId: child.backendNodeId,
            pierce: true,
            depth: 1,
          }, oopifSessionId).catch(() => null);
          if (childDesc?.node?.shadowRoots?.length) {
            for (const sr of childDesc.node.shadowRoots) {
              const found = await this.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
              if (found) return found;
            }
          }
        }
      }

      return null;
    } catch (err) {
      this.events.marker(oopifSessionId, 'cf.runtime_query_error', {
        error: (err as Error)?.message || 'unknown',
      });
      return null;
    }
  }

  /**
   * Find checkbox using an isolated JS world — matches pydoll's exact approach.
   *
   * Pydoll's IFrameContextResolver creates an isolated world via
   * Page.createIsolatedWorld(frameId, worldName, grantUniversalAccess=True),
   * then all DOM queries run in that isolated context:
   *   Runtime.evaluate('document.documentElement', contextId=isolated)
   *   → iframe.find(tag_name='body') via Runtime.callFunctionOn
   *   → body.get_shadow_root() via DOM.describeNode(pierce=true) + DOM.resolveNode
   *   → inner_shadow.query('span.cb-i') via Runtime.callFunctionOn
   *
   * CF's WASM in the main world cannot observe execution in isolated worlds.
   */
  private async findCheckboxViaIsolatedWorld(
    send: SendCommand,
    oopifSessionId: string,
    contextId: number,
  ): Promise<{ objectId: string; backendNodeId: number } | null> {
    try {
      // Get document root in the isolated world (pydoll: Runtime.evaluate('document.documentElement'))
      const docResult = await send('Runtime.evaluate', {
        expression: 'document.documentElement',
        contextId,
        returnByValue: false,
      }, oopifSessionId);
      if (!docResult?.result?.objectId) return null;

      // Find body (pydoll: iframe.find(tag_name='body'))
      const bodyResult = await send('Runtime.callFunctionOn', {
        objectId: docResult.result.objectId,
        functionDeclaration: `function() { return this.querySelector('body'); }`,
        returnByValue: false,
      }, oopifSessionId);
      if (!bodyResult?.result?.objectId) return null;

      // Describe body with pierce to get shadow roots (pydoll: body.get_shadow_root())
      const bodyDesc = await send('DOM.describeNode', {
        objectId: bodyResult.result.objectId,
        pierce: true,
        depth: 1,
      }, oopifSessionId);

      const shadowRoots = bodyDesc?.node?.shadowRoots;
      if (shadowRoots?.length) {
        for (const sr of shadowRoots) {
          const found = await this.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
          if (found) return found;
        }
      }

      // Search children for shadow hosts (one level deeper)
      const children = bodyDesc?.node?.children;
      if (children?.length) {
        for (const child of children) {
          const childDesc = await send('DOM.describeNode', {
            backendNodeId: child.backendNodeId,
            pierce: true,
            depth: 1,
          }, oopifSessionId).catch(() => null);
          if (childDesc?.node?.shadowRoots?.length) {
            for (const sr of childDesc.node.shadowRoots) {
              const found = await this.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
              if (found) return found;
            }
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private async queryCheckboxInShadowUsing(
    send: SendCommand,
    oopifSessionId: string,
    shadowBackendNodeId: number,
  ): Promise<{ objectId: string; backendNodeId: number } | null> {
    // Resolve shadow root to objectId
    const shadowResolved = await send('DOM.resolveNode', {
      backendNodeId: shadowBackendNodeId,
    }, oopifSessionId);
    if (!shadowResolved?.object?.objectId) return null;

    // Try span.cb-i first (Turnstile's primary checkbox indicator)
    const cbResult = await send('Runtime.callFunctionOn', {
      objectId: shadowResolved.object.objectId,
      functionDeclaration: `function() { return this.querySelector('span.cb-i') || this.querySelector('input[type="checkbox"]'); }`,
      returnByValue: false,
    }, oopifSessionId);

    if (!cbResult?.result?.objectId || cbResult.result.subtype === 'null') return null;

    // Get the backendNodeId for the checkbox (needed for getBoxModel)
    const cbDesc = await send('DOM.describeNode', {
      objectId: cbResult.result.objectId,
    }, oopifSessionId);

    if (!cbDesc?.node?.backendNodeId) return null;

    return {
      objectId: cbResult.result.objectId,
      backendNodeId: cbDesc.node.backendNodeId,
    };
  }

  // ── CDP-based Shadow DOM Discovery + Trusted Click ──────────────────

  /**
   * Find Turnstile checkbox and click it using active OOPIF discovery
   * and Runtime.callFunctionOn — matching pydoll's exact approach.
   *
   * Flow:
   * 1. Active OOPIF discovery via Target.getTargets + attachToTarget
   * 2. Find checkbox via Runtime.callFunctionOn(querySelector) in OOPIF
   * 3. Fallback: DOM.getDocument tree walk (backward compat)
   * 4. DOM.getBoxModel for coordinates
   * 5. Input.dispatchMouseEvent via PAGE session (Bezier approach)
   */
  private async findAndClickViaCDP(
    active: ActiveDetection,
    attempt = 0,
  ): Promise<boolean> {
    const { pageCdpSessionId } = active;

    // Route OOPIF commands through CDPProxy's browser WS — matching pydoll's
    // actual routing through Browserless. Pydoll's OOPIF patch stores
    // chrome._connection_handler (= CDPProxy browser WS) as _browser_handler,
    // and all OOPIF commands (Target.getTargets, attachToTarget, DOM queries,
    // Input.dispatchMouseEvent) route through it via _execute_command → _resolve_routing.
    //
    // We previously used a fresh isolated WS (createIsolatedConnection), thinking
    // zero CDP state would be cleaner. But pydoll succeeds through CDPProxy and
    // we failed through isolated WS — the isolated WS is not the advantage.
    const rawSend = this.sendViaProxy || this.sendCommand;
    const via = this.sendViaProxy ? 'proxy_ws' : 'direct_ws';

    // Debug wrapper: log every CDP command, response summary, and timing
    const debugEnabled = !!process.env.BROWSERLESS_CDP_DEBUG;
    const solveStart = Date.now();
    let cmdSeq = 0;
    const send: SendCommand = async (method, params, sessionId, timeoutMs) => {
      const seq = cmdSeq++;
      const sid = sessionId ? `[sid=${sessionId.substring(0, 16)}]` : '[no-sid]';
      const t0 = Date.now() - solveStart;
      if (debugEnabled) {
        const p = params ? JSON.stringify(params).substring(0, 150) : '{}';
        console.log(`  [SOLVE #${seq}] +${t0}ms ${method} ${sid} ${p}`);
      }
      const result = await rawSend(method, params, sessionId, timeoutMs);
      if (debugEnabled) {
        const t1 = Date.now() - solveStart;
        const summary = result ? JSON.stringify(result).substring(0, 120) : 'null';
        console.log(`  [SOLVE #${seq}] +${t1}ms → ${summary}`);
      }
      return result;
    };

    try {
      // ──────────────────────────────────────────────────────────────────
      // Pydoll's exact flow replicated:
      //   Phase 1: Page-side DOM traversal (PAGE session via this.sendCommand)
      //   Phase 2: OOPIF resolution (CDPProxy browser WS via send)
      //   Phase 3: Isolated world + checkbox (OOPIF session via send)
      //   Phase 4: Click (OOPIF session via send)
      // ──────────────────────────────────────────────────────────────────

      // ── Phase 1: Page-side shadow root traversal (PAGE session) ──────
      // Pydoll calls find_shadow_roots(deep=False) → DOM.getDocument(depth=-1, pierce=true)
      // then checks each shadow root's inner_html for challenges.cloudflare.com,
      // then querySelector('iframe[src*="challenges.cloudflare.com"]') on the shadow root,
      // then DOM.describeNode on the iframe element to get frameId + backendNodeId.
      let iframeBackendNodeId: number | null = null;
      let iframeFrameId: string | null = null;
      let phase1Ms = 0;

      // Wrap page-session commands with debug logging too
      const pageSend: SendCommand = async (method, params, sessionId, timeoutMs) => {
        const seq = cmdSeq++;
        const t0 = Date.now() - solveStart;
        if (debugEnabled) {
          const p = params ? JSON.stringify(params).substring(0, 150) : '{}';
          console.log(`  [PAGE  #${seq}] +${t0}ms ${method} [page-session] ${p}`);
        }
        const result = await this.sendCommand(method, params, sessionId, timeoutMs);
        if (debugEnabled) {
          const t1 = Date.now() - solveStart;
          const summary = result ? JSON.stringify(result).substring(0, 120) : 'null';
          console.log(`  [PAGE  #${seq}] +${t1}ms → ${summary}`);
        }
        return result;
      };

      // ── Phase 1: Page-side DOM traversal (CLEAN page WS) ──────────────
      //
      // WHY A CLEAN WS IS CRITICAL:
      // ReplaySession's WS has accumulated V8 state from recording setup:
      //   - Page.addScriptToEvaluateOnNewDocument (rrweb injection)
      //   - Runtime.addBinding (__csrfp, __perf)
      // When ANY command — even safe ones like Runtime.callFunctionOn —
      // executes through this tainted WS, CF's WASM detects the accumulated
      // V8 modifications and permanently poisons the session. All subsequent
      // clicks get rejected, no matter how they're delivered.
      //
      // Pydoll succeeds with the SAME commands because its page-level WS
      // (/devtools/page/{targetId}) is a fresh connection with zero V8 state.
      // We match that by opening our own clean page WS per solve attempt.
      //
      // See CLOUDFLARE_SOLVER.md "Rule 2" for the full investigation.
      //
      if (this.chromePort && active.pageTargetId) {
        const phase1Start = Date.now();
        let cleanWs: { send: (method: string, params?: object) => Promise<any>; cleanup: () => void } | null = null;
        try {
          cleanWs = await this.openCleanPageWs(active.pageTargetId);

          // DOM.getDocument(depth:-1, pierce:true) — C++ layer, finds shadow roots
          const doc = await cleanWs.send('DOM.getDocument', { depth: -1, pierce: true });
          if (doc?.root) {
            // Walk tree for iframe[src*="challenges.cloudflare.com"]
            const iframe = this.findCFIframeInTree(doc.root);
            if (iframe) {
              iframeBackendNodeId = iframe.backendNodeId;
              iframeFrameId = iframe.frameId ?? null;
            }
          }
        } catch {
          // Phase 1 failure is non-fatal — Phase 2 fallback handles it
        } finally {
          cleanWs?.cleanup();
        }
        phase1Ms = Date.now() - phase1Start;
      }

      this.events.marker(pageCdpSessionId, 'cf.page_traversal', {
        iframe_backend_node_id: iframeBackendNodeId,
        iframe_frame_id: iframeFrameId ? (iframeFrameId as string).substring(0, 20) : null,
        via, attempt,
        skipped_phase1: !iframeFrameId && !iframeBackendNodeId,
        phase1_ms: phase1Ms,
      });

      // ── Phase 2: OOPIF resolution (isolated WS) ─────────────────────
      // Pydoll creates a new ConnectionHandler, calls Target.getTargets,
      // then for each target: attachToTarget → Page.getFrameTree → DOM.getFrameOwner
      // → match backendNodeId from Phase 1.
      let oopifSessionId: string | null = null;

      const { targetInfos } = await send('Target.getTargets');
      if (targetInfos?.length) {
        // Filter out test widgets
        const candidates = targetInfos.filter(
          (t: { type: string; url?: string }) =>
            (t.type === 'iframe' || t.type === 'page')
            && t.url?.includes('challenges.cloudflare.com')
            && !isCFTestWidget(t.url),
        );

        if (iframeFrameId && candidates.length > 0) {
          // Primary: match by frameId from page-side DOM.describeNode
          // The iframe element's frameId (from page session) matches the target's
          // frame tree root frame ID. frameId is a global Chrome identifier (unlike
          // backendNodeId which is per-connection).
          for (const target of candidates) {
            try {
              const { sessionId: trySessionId } = await send('Target.attachToTarget', {
                targetId: target.targetId,
                flatten: true,
              });
              if (!trySessionId) continue;

              const ft = await send('Page.getFrameTree', {}, trySessionId).catch(() => null);
              const frameId = ft?.frameTree?.frame?.id;
              if (!frameId) continue;

              if (frameId === iframeFrameId || target.targetId === iframeFrameId) {
                oopifSessionId = trySessionId;
                this.events.marker(pageCdpSessionId, 'cf.oopif_discovered', {
                  method: 'active', via,
                  filter: 'frameId_match',
                  targetId: target.targetId,
                  url: target.url?.substring(0, 100),
                  total_candidates: candidates.length,
                });
                break;
              }
            } catch {
              // This target didn't match — try next
            }
          }
        }

        // Fallback: parentFrameId filter (if page-side traversal failed)
        if (!oopifSessionId) {
          let pageFrameId: string | null = null;
          try {
            const frameTree = await pageSend('Page.getFrameTree', {}, pageCdpSessionId);
            pageFrameId = frameTree?.frameTree?.frame?.id ?? null;
          } catch { /* ignore */ }

          let cfTargets = pageFrameId
            ? candidates.filter(
                (t: { parentFrameId?: string }) => t.parentFrameId === pageFrameId,
              )
            : [];

          if (cfTargets.length === 0) cfTargets = candidates;

          if (cfTargets.length > 0) {
            const target = cfTargets[0];
            const { sessionId } = await send('Target.attachToTarget', {
              targetId: target.targetId,
              flatten: true,
            });
            if (sessionId) {
              oopifSessionId = sessionId;
              this.events.marker(pageCdpSessionId, 'cf.oopif_discovered', {
                method: 'active', via,
                filter: pageFrameId ? 'parentFrameId' : 'url',
                targetId: target.targetId,
                url: target.url?.substring(0, 100),
                total_candidates: cfTargets.length,
              });
            }
          }
        }
      }

      if (!oopifSessionId) {
        this.events.marker(pageCdpSessionId, 'cf.cdp_no_oopif', {
          type: active.info.type, via,
          had_iframe_backend_id: !!iframeBackendNodeId,
          total_targets: targetInfos?.length ?? 0,
          elapsed_ms: Date.now() - solveStart,
        });
        return false;
      }

      // ── Phase 3: Isolated world + checkbox find (OOPIF session) ──────
      // Pydoll: Page.createIsolatedWorld → Runtime.evaluate('document.documentElement')
      //   → callFunctionOn(querySelector('body')) → DOM.describeNode(pierce=true, depth=1)
      //   → DOM.resolveNode(shadowRoot) → callFunctionOn(querySelector('span.cb-i'))
      let isolatedContextId: number | null = null;
      let oopifFrameId: string | null = null;
      try {
        const frameTreeResult = await send('Page.getFrameTree', {}, oopifSessionId);
        oopifFrameId = frameTreeResult?.frameTree?.frame?.id ?? null;

        if (oopifFrameId) {
          // NOTE: pydoll has a typo "grantUniveralAccess" (missing 's') which
          // Chrome ignores, so pydoll's isolated world does NOT have universal access.
          // We intentionally omit grantUniversalAccess to match pydoll's actual behavior.
          const isolatedWorld = await send('Page.createIsolatedWorld', {
            frameId: oopifFrameId,
            worldName: `browserless::cf::${oopifFrameId}`,
          }, oopifSessionId);
          isolatedContextId = isolatedWorld?.executionContextId ?? null;
        }
      } catch {
        // Isolated world creation failed — fall through to non-isolated path
      }

      this.events.marker(pageCdpSessionId, 'cf.cdp_dom_session', {
        using_iframe: true, type: active.info.type, via,
        isolated_world: !!isolatedContextId,
        oopif_frame_id: oopifFrameId ?? 'none',
      });

      // Find checkbox with polling — matching pydoll's behavior.
      // Pydoll's querySelector('span.cb-i') returns null initially and polls
      // ~4 times over ~2 seconds with 500ms gaps. This wait is critical:
      // CF's WASM needs time to render the widget after the OOPIF loads.
      // Clicking immediately (within ms of attach) causes rechallenge.
      let checkbox: { objectId: string; backendNodeId: number } | null = null;
      let method = 'none';
      let pollCount = 0;

      const maxPolls = 8; // up to 4 seconds of polling
      const pollInterval = 500; // match pydoll's ~500ms gap

      for (let poll = 0; poll < maxPolls; poll++) {
        if (active.aborted) return false;
        pollCount = poll + 1;

        if (isolatedContextId) {
          checkbox = await this.findCheckboxViaIsolatedWorld(send, oopifSessionId, isolatedContextId);
          if (checkbox) { method = 'isolated_world'; break; }
        }

        if (!checkbox) {
          checkbox = await this.findCheckboxViaRuntimeUsing(send, oopifSessionId);
          if (checkbox) { method = 'runtime_query'; break; }
        }

        if (!checkbox) {
          const doc = await send('DOM.getDocument', {
            depth: -1, pierce: true,
          }, oopifSessionId).catch(() => null);
          if (doc?.root) {
            const node = this.findCheckboxInTree(doc.root);
            if (node) {
              checkbox = { objectId: '', backendNodeId: node.backendNodeId };
              method = 'dom_tree_walk';
              break;
            }
          }
        }

        // Checkbox not found yet — wait and retry (matching pydoll's polling)
        await sleep(pollInterval);
      }

      if (!checkbox) {
        this.events.marker(pageCdpSessionId, 'cf.cdp_no_checkbox', { via, polls: pollCount });
        return false;
      }

      const checkboxFoundAt = Date.now();
      this.events.marker(pageCdpSessionId, 'cf.cdp_checkbox_found', {
        method, backendNodeId: checkbox.backendNodeId,
        has_objectId: !!checkbox.objectId, via, polls: pollCount,
        checkbox_found_ms: checkboxFoundAt - solveStart,
      });
      this.events.emitProgress(active, 'widget_found', { method, x: 0, y: 0 });

      // ── Phase 4: Visibility check, scroll, bounds, click ─────────────
      // No artificial delay — pydoll clicks immediately after finding the
      // checkbox. The retry loop in solveByClicking polls every 500ms which
      // naturally gives CF's WASM time to arm.

      // Pydoll does a visibility check (getBoundingClientRect + getComputedStyle)
      // before clicking. This confirms the element is rendered and interactive.
      if (checkbox.objectId) {
        const visible = await send('Runtime.callFunctionOn', {
          objectId: checkbox.objectId,
          functionDeclaration: `function() {
            const rect = this.getBoundingClientRect();
            return (rect.width > 0 && rect.height > 0
              && getComputedStyle(this).visibility !== 'hidden'
              && getComputedStyle(this).display !== 'none');
          }`,
          returnByValue: true,
        }, oopifSessionId).catch(() => null);

        if (visible?.result?.value === false) {
          this.events.marker(pageCdpSessionId, 'cf.checkbox_not_visible', { via, polls: pollCount });
          return false;
        }
      }

      // scrollIntoView
      const scrollParams = checkbox.objectId
        ? { objectId: checkbox.objectId }
        : { backendNodeId: checkbox.backendNodeId };
      await send('DOM.scrollIntoViewIfNeeded', scrollParams, oopifSessionId)
        .catch(() => {});

      // DOM.getBoxModel with getBoundingClientRect fallback
      const boxParams = checkbox.objectId
        ? { objectId: checkbox.objectId }
        : { backendNodeId: checkbox.backendNodeId };
      const box = await send('DOM.getBoxModel', boxParams, oopifSessionId).catch(() => null);

      let x: number, y: number;
      let coordSource = 'getBoxModel';

      if (box?.model?.content) {
        const quad = box.model.content;
        x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      } else if (checkbox.objectId) {
        const boundsResult = await send('Runtime.callFunctionOn', {
          objectId: checkbox.objectId,
          functionDeclaration: `function() {
            const r = this.getBoundingClientRect();
            return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
          }`,
          returnByValue: true,
        }, oopifSessionId).catch(() => null);
        const bounds = JSON.parse(boundsResult?.result?.value || '{}');
        if (!bounds.width) {
          this.events.marker(pageCdpSessionId, 'cf.cdp_no_box_model', { method, via });
          return false;
        }
        x = bounds.x + bounds.width / 2;
        y = bounds.y + bounds.height / 2;
        coordSource = 'getBoundingClientRect';
      } else {
        this.events.marker(pageCdpSessionId, 'cf.cdp_no_box_model', { method, via });
        return false;
      }

      this.events.marker(pageCdpSessionId, 'cf.cdp_click_target', {
        x: Math.round(x), y: Math.round(y),
        method, via, coordSource,
      });

      // Bare press + random hold + release — NO mouseMoved (matches pydoll exactly)
      const clickX = Math.round(x);
      const clickY = Math.round(y);

      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: clickX, y: clickY,
        button: 'left', clickCount: 1,
      }, oopifSessionId);
      await sleep(50 + Math.random() * 100);
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: clickX, y: clickY,
        button: 'left', clickCount: 1,
      }, oopifSessionId);

      // Track click delivery for solve attribution
      active.clickDelivered = true;
      active.clickDeliveredAt = Date.now();
      this.events.emitProgress(active, 'clicked', { x: clickX, y: clickY });

      this.events.marker(pageCdpSessionId, 'cf.oopif_click', {
        ok: true, method: 'cdp_oopif_session', via, attempt,
        x: clickX, y: clickY,
        elapsed_since_solve_start_ms: Date.now() - solveStart,
        checkbox_to_click_ms: Date.now() - checkboxFoundAt,
      });
      return true;
    } catch (err) {
      this.events.marker(pageCdpSessionId, 'cf.cdp_error', {
        error: (err as Error)?.message || 'unknown', via, attempt,
        elapsed_ms: Date.now() - solveStart,
      });
      return false;
    }
  }


  // ── Clean Page WS for Phase 1 ──────────────────────────────────────

  /**
   * Open a fresh /devtools/page/{targetId} WS with zero V8 state.
   *
   * WHY: ReplaySession's WS is tainted by rrweb's addScriptToEvaluateOnNewDocument
   * and Runtime.addBinding calls. CF's WASM detects this accumulated V8 state and
   * rejects all subsequent clicks through the tainted connection. A fresh page WS
   * has zero state — matching how pydoll connects via /devtools/page/{targetId}.
   *
   * The WS is opened, used for one DOM.getDocument call, and immediately closed.
   * Pattern from replay-session.ts:openPageWebSocket.
   */
  private async openCleanPageWs(targetId: string): Promise<{
    send: (method: string, params?: object) => Promise<any>;
    cleanup: () => void;
  }> {
    const WebSocket = (await import('ws')).default;
    const pageWsUrl = `ws://127.0.0.1:${this.chromePort}/devtools/page/${targetId}`;
    const ws = new WebSocket(pageWsUrl);
    const pending = new Map<number, { resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }>();
    let cmdId = 500_000;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { ws.terminate(); reject(new Error('Clean page WS timeout')); }, 2000);
      ws.on('open', () => { clearTimeout(timer); resolve(); });
      ws.on('error', reject);
    });

    ws.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) { clearTimeout(p.timer); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      }
    });

    return {
      send: (method, params = {}) => new Promise((resolve, reject) => {
        const id = cmdId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10_000);
        pending.set(id, { resolve, reject, timer });
        ws.send(JSON.stringify({ id, method, params }));
      }),
      cleanup: () => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('cleanup')); } pending.clear(); ws.terminate(); },
    };
  }

  /**
   * Walk CDP DOM tree to find the CF challenge iframe node.
   * Returns the IFRAME node with backendNodeId and frameId for Phase 2 matching.
   */
  private findCFIframeInTree(node: CDPNode): CDPNode | null {
    if (node.nodeName === 'IFRAME') {
      const attrs = node.attributes ?? [];
      for (let i = 0; i < attrs.length; i += 2) {
        if (attrs[i] === 'src' && attrs[i + 1]?.includes('challenges.cloudflare.com')) {
          return node;
        }
      }
    }
    for (const child of node.children ?? []) {
      const found = this.findCFIframeInTree(child);
      if (found) return found;
    }
    for (const shadow of node.shadowRoots ?? []) {
      const found = this.findCFIframeInTree(shadow);
      if (found) return found;
    }
    if (node.contentDocument) {
      const found = this.findCFIframeInTree(node.contentDocument);
      if (found) return found;
    }
    return null;
  }

  // ── CDP-based Detection (zero JS injection) ────────────────────────

  /**
   * Detect Turnstile widget via Target.getTargets (browser-level).
   * Zero page interaction — no DOM walk, no Runtime.evaluate.
   *
   * WARNING: Do NOT upgrade this to use DOM.getDocument or Runtime.evaluate —
   * even on a fresh clean-page WS connection. The detection polling loop runs
   * 20 polls × 200ms, and repeated page-level CDP calls during that window
   * trigger CF's WASM fingerprint checks, causing rechallenges on every click.
   * Proven 2026-02-24: Target.getTargets = 5/5 pass, DOM.getDocument = timeout,
   * Runtime.evaluate = rechallenge. Target.getTargets is browser-level and
   * completely invisible to the page.
   */
  async detectTurnstileViaCDP(_pageCdpSessionId: string): Promise<CFDetectionResult | null> {
    try {
      const send = this.sendViaProxy || this.sendCommand;
      const { targetInfos } = await send('Target.getTargets');
      if (!targetInfos?.length) return { present: false };

      const hasCFIframe = targetInfos.some(
        (t: { type: string; url?: string }) =>
          (t.type === 'iframe' || t.type === 'page')
          && t.url?.includes('challenges.cloudflare.com')
          && !isCFTestWidget(t.url),
      );
      return { present: hasCFIframe };
    } catch {
      return null;
    }
  }

  /**
   * Check Turnstile OOPIF state via CDP DOM walk.
   * Replaces the MutationObserver + __turnstileStateBinding injection.
   *
   * Inspects the OOPIF's DOM tree for state indicator elements:
   * - #success (display !== none) → 'success'
   * - #fail → 'fail'
   * - #expired → 'expired'
   * - #timeout → 'timeout'
   * - #verifying → 'verifying' (mapped to 'pending')
   * - none visible → 'pending'
   */
  async checkOOPIFStateViaCDP(iframeCdpSessionId: string): Promise<
    'success' | 'fail' | 'expired' | 'timeout' | 'pending' | null
  > {
    try {
      const doc = await this.sendCommand('DOM.getDocument', {
        depth: -1,
        pierce: true,
      }, iframeCdpSessionId);

      if (!doc?.root) return null;

      return this.findStateInOOPIFTree(doc.root);
    } catch {
      return null;
    }
  }

  // ── DOM Tree Walking ────────────────────────────────────────────────


  /**
   * Walk the CDP DOM tree to find the Turnstile checkbox element.
   *
   * Searches for:
   * 1. span.cb-i — the visual checkbox indicator in Turnstile's shadow DOM
   * 2. input[type=checkbox] — direct checkbox input
   * 3. Any visible input element inside a shadow root
   *
   * Traverses both children[] and shadowRoots[] at each node.
   */
  private findCheckboxInTree(node: CDPNode): CDPNode | null {
    // Check current node
    if (this.isCheckboxTarget(node)) return node;

    // Search shadow roots first (checkbox lives inside shadow DOM)
    if (node.shadowRoots) {
      for (const shadow of node.shadowRoots) {
        const found = this.findCheckboxInTree(shadow);
        if (found) return found;
      }
    }

    // Search content document (for iframe nodes)
    if (node.contentDocument) {
      const found = this.findCheckboxInTree(node.contentDocument);
      if (found) return found;
    }

    // Search children
    if (node.children) {
      for (const child of node.children) {
        const found = this.findCheckboxInTree(child);
        if (found) return found;
      }
    }

    return null;
  }

  /**
   * Check if a DOM node is the Turnstile checkbox target.
   */
  private isCheckboxTarget(node: CDPNode): boolean {
    const name = node.localName || node.nodeName?.toLowerCase();
    if (!name) return false;

    // span.cb-i — Turnstile's checkbox indicator element
    if (name === 'span' && this.hasClass(node, 'cb-i')) return true;

    // input[type=checkbox]
    if (name === 'input' && this.getAttr(node, 'type') === 'checkbox') return true;

    return false;
  }

  /** Check if node has a specific CSS class. */
  private hasClass(node: CDPNode, className: string): boolean {
    const classAttr = this.getAttr(node, 'class');
    if (!classAttr) return false;
    return classAttr.split(/\s+/).includes(className);
  }

  /** Get attribute value from CDP node attributes array. */
  private getAttr(node: CDPNode, name: string): string | null {
    if (!node.attributes) return null;
    // attributes is flat: [name1, val1, name2, val2, ...]
    for (let i = 0; i < node.attributes.length - 1; i += 2) {
      if (node.attributes[i] === name) return node.attributes[i + 1];
    }
    return null;
  }


  /**
   * Walk the OOPIF DOM tree to find Turnstile state indicator elements.
   *
   * Turnstile OOPIF has elements with IDs: success, verifying, fail, expired, timeout.
   * The visible one (computed style display !== 'none') indicates current state.
   *
   * Since we can't check computed styles via DOM.getDocument, we look for element
   * presence and rely on Turnstile's pattern of only having the active state element
   * with visible styles. We check via DOM.resolveNode + Runtime.callFunctionOn
   * to get computed display for each candidate.
   *
   * Simplified approach: just check if state elements exist in the tree.
   * The activity loop calls this frequently, so we detect state transitions
   * by comparing with previous state.
   */
  private findStateInOOPIFTree(node: CDPNode): 'success' | 'fail' | 'expired' | 'timeout' | 'pending' {
    const stateIds = ['success', 'fail', 'expired', 'timeout'];
    const found = new Set<string>();
    this.collectElementsById(node, stateIds, found);

    // If #success element exists in the tree, Turnstile typically only renders
    // it when the challenge is solved. But we need visibility checks.
    // For now, check presence — the activity loop also checks isSolved() which
    // validates via turnstile.getResponse() / input value.
    // The actual visibility check requires Runtime.evaluate on the OOPIF session,
    // which we'll do as a focused check when we find state elements.
    if (found.has('success')) return 'success';
    if (found.has('fail')) return 'fail';
    if (found.has('expired')) return 'expired';
    if (found.has('timeout')) return 'timeout';

    return 'pending';
  }

  /** Collect elements by ID from the DOM tree. */
  private collectElementsById(node: CDPNode, ids: string[], found: Set<string>): void {
    const nodeId = this.getAttr(node, 'id');
    if (nodeId && ids.includes(nodeId)) {
      found.add(nodeId);
    }
    if (node.shadowRoots) {
      for (const shadow of node.shadowRoots) {
        this.collectElementsById(shadow, ids, found);
      }
    }
    if (node.contentDocument) {
      this.collectElementsById(node.contentDocument, ids, found);
    }
    if (node.children) {
      for (const child of node.children) {
        this.collectElementsById(child, ids, found);
      }
    }
  }
}
