import { Effect } from 'effect';
import type { CdpSessionId, TargetId, CloudflareType } from '../../shared/cloudflare-detection.js';
import type { ActiveDetection, CloudflareEventEmitter } from './cloudflare-event-emitter.js';
import type { SendCommand } from './cloudflare-state-tracker.js';
// CdpSessionGone available for future typed error channels

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
 *
 * All methods return Effect — callers use yield* from Effect.gen contexts.
 *
 * Pydoll's exact flow replicated:
 *   Phase 1: Page-side DOM traversal (PAGE session via this.sendCommand)
 *   Phase 2: OOPIF resolution (CDPProxy browser WS via send)
 *   Phase 3: Isolated world + checkbox (OOPIF session via send)
 *   Phase 4: Click (OOPIF session via send)
 */
export class CloudflareSolveStrategies {
  /**
   * Optional proxy-routed sendCommand (through CDPProxy's browserWs).
   */
  private sendViaProxy: SendCommand | null = null;

  constructor(
    private sendCommand: SendCommand,
    private events: CloudflareEventEmitter,
    private chromePort?: string,
  ) {}

  setSendViaProxy(fn: SendCommand): void {
    this.sendViaProxy = fn;
  }

  /**
   * Overridable solve dispatcher. CloudflareSolver replaces this with the
   * Effect-based solver in the constructor. No-op default — never called
   * in production because the constructor always overrides it.
   */
  solveDetection: (active: ActiveDetection) => Promise<SolveOutcome> =
    () => Promise.resolve('aborted' as SolveOutcome);

  // ── Runtime.callFunctionOn Element Finding (matches pydoll) ─────────

  /**
   * Find the Turnstile checkbox using a specific sendCommand function.
   * This allows routing ALL commands through the same WS connection
   * (critical because CDP session IDs are per-connection).
   * Returns Effect to compose with the calling Effect chain.
   */
  private findCheckboxViaRuntimeUsing(
    send: SendCommand,
    oopifSessionId: CdpSessionId,
  ): Effect.Effect<{ objectId: string; backendNodeId: number } | null> {
    const strategies = this;
    return Effect.gen(function*() {
      // Step 1: Get document node
      const doc = yield* Effect.tryPromise(() => send('DOM.getDocument', {
        depth: 0,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!doc?.root) return null;

      // Step 2: Resolve document to get its objectId
      const resolved = yield* Effect.tryPromise(() => send('DOM.resolveNode', {
        nodeId: doc.root.nodeId,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!resolved?.object?.objectId) return null;

      // Step 3: Find body element via Runtime.callFunctionOn
      const bodyResult = yield* Effect.tryPromise(() => send('Runtime.callFunctionOn', {
        objectId: resolved.object.objectId,
        functionDeclaration: `function() { return this.querySelector('body'); }`,
        returnByValue: false,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!bodyResult?.result?.objectId) return null;

      // Step 4: Describe body node with pierce=true to get shadow root
      const bodyDesc = yield* Effect.tryPromise(() => send('DOM.describeNode', {
        objectId: bodyResult.result.objectId,
        pierce: true,
        depth: 1,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));

      // The Turnstile checkbox is inside a shadow root on the body or a child.
      // Walk shadow roots to find the one containing span.cb-i.
      const shadowRoots = bodyDesc?.node?.shadowRoots;

      if (shadowRoots?.length) {
        // Try each shadow root
        for (const sr of shadowRoots) {
          const found = yield* strategies.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
          if (found) return found;
        }
      }

      // If no shadow roots on body, search children for shadow hosts
      // (Turnstile might nest the shadow root one level deeper)
      const children = bodyDesc?.node?.children;
      if (children?.length) {
        for (const child of children) {
          const childDesc = yield* Effect.tryPromise(() => send('DOM.describeNode', {
            backendNodeId: child.backendNodeId,
            pierce: true,
            depth: 1,
          }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
          if (childDesc?.node?.shadowRoots?.length) {
            for (const sr of childDesc.node.shadowRoots) {
              const found = yield* strategies.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
              if (found) return found;
            }
          }
        }
      }

      return null;
    }).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
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
  private findCheckboxViaIsolatedWorld(
    send: SendCommand,
    oopifSessionId: CdpSessionId,
    contextId: number,
  ): Effect.Effect<{ objectId: string; backendNodeId: number } | null> {
    const strategies = this;
    return Effect.gen(function*() {
      // Get document root in the isolated world (pydoll: Runtime.evaluate('document.documentElement'))
      const docResult = yield* Effect.tryPromise(() => send('Runtime.evaluate', {
        expression: 'document.documentElement',
        contextId,
        returnByValue: false,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!docResult?.result?.objectId) return null;

      // Find body (pydoll: iframe.find(tag_name='body'))
      const bodyResult = yield* Effect.tryPromise(() => send('Runtime.callFunctionOn', {
        objectId: docResult.result.objectId,
        functionDeclaration: `function() { return this.querySelector('body'); }`,
        returnByValue: false,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!bodyResult?.result?.objectId) return null;

      // Describe body with pierce to get shadow roots (pydoll: body.get_shadow_root())
      const bodyDesc = yield* Effect.tryPromise(() => send('DOM.describeNode', {
        objectId: bodyResult.result.objectId,
        pierce: true,
        depth: 1,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));

      const shadowRoots = bodyDesc?.node?.shadowRoots;
      if (shadowRoots?.length) {
        for (const sr of shadowRoots) {
          const found = yield* strategies.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
          if (found) return found;
        }
      }

      // Search children for shadow hosts (one level deeper)
      const children = bodyDesc?.node?.children;
      if (children?.length) {
        for (const child of children) {
          const childDesc = yield* Effect.tryPromise(() => send('DOM.describeNode', {
            backendNodeId: child.backendNodeId,
            pierce: true,
            depth: 1,
          }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
          if (childDesc?.node?.shadowRoots?.length) {
            for (const sr of childDesc.node.shadowRoots) {
              const found = yield* strategies.queryCheckboxInShadowUsing(send, oopifSessionId, sr.backendNodeId);
              if (found) return found;
            }
          }
        }
      }

      return null;
    }).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
  }

  private queryCheckboxInShadowUsing(
    send: SendCommand,
    oopifSessionId: CdpSessionId,
    shadowBackendNodeId: number,
  ): Effect.Effect<{ objectId: string; backendNodeId: number } | null> {
    return Effect.gen(function*() {
      // Resolve shadow root to objectId
      const shadowResolved = yield* Effect.tryPromise(() => send('DOM.resolveNode', {
        backendNodeId: shadowBackendNodeId,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
      if (!shadowResolved?.object?.objectId) return null;

      // Try span.cb-i first (Turnstile's primary checkbox indicator)
      const cbResult = yield* Effect.tryPromise(() => send('Runtime.callFunctionOn', {
        objectId: shadowResolved.object.objectId,
        functionDeclaration: `function() { return this.querySelector('span.cb-i') || this.querySelector('input[type="checkbox"]'); }`,
        returnByValue: false,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));

      if (!cbResult?.result?.objectId || cbResult.result.subtype === 'null') return null;

      // Get the backendNodeId for the checkbox (needed for getBoxModel)
      const cbDesc = yield* Effect.tryPromise(() => send('DOM.describeNode', {
        objectId: cbResult.result.objectId,
      }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));

      if (!cbDesc?.node?.backendNodeId) return null;

      return {
        objectId: cbResult.result.objectId,
        backendNodeId: cbDesc.node.backendNodeId,
      };
    });
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
   * 5. Input.dispatchMouseEvent via OOPIF session
   *
   * Public entry point — returns Effect.
   * Called by the Effect solver directly (no more bridge).
   */
  findAndClickViaCDP(
    active: ActiveDetection,
    attempt = 0,
  ): Effect.Effect<boolean> {
    return this._findAndClickViaCDP(active, attempt);
  }

  /**
   * Also exposed as a Promise-returning wrapper for the bridge during transition.
   */
  async findAndClickViaCDPDirect(
    active: ActiveDetection,
    attempt = 0,
  ): Promise<boolean> {
    return Effect.runPromise(this._findAndClickViaCDP(active, attempt));
  }

  private _findAndClickViaCDP(
    active: ActiveDetection,
    attempt = 0,
  ): Effect.Effect<boolean> {
    const strategies = this;
    return Effect.gen(function*() {
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
      const rawSend = strategies.sendViaProxy || strategies.sendCommand;
      const via = strategies.sendViaProxy ? 'proxy_ws' : 'direct_ws';

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

      // Wrap page-session commands with debug logging too
      const pageSend: SendCommand = async (method, params, sessionId, timeoutMs) => {
        const seq = cmdSeq++;
        const t0 = Date.now() - solveStart;
        if (debugEnabled) {
          const p = params ? JSON.stringify(params).substring(0, 150) : '{}';
          console.log(`  [PAGE  #${seq}] +${t0}ms ${method} [page-session] ${p}`);
        }
        const result = await strategies.sendCommand(method, params, sessionId, timeoutMs);
        if (debugEnabled) {
          const t1 = Date.now() - solveStart;
          const summary = result ? JSON.stringify(result).substring(0, 120) : 'null';
          console.log(`  [PAGE  #${seq}] +${t1}ms → ${summary}`);
        }
        return result;
      };

      // ──────────────────────────────────────────────────────────────────
      // Pydoll's exact flow replicated:
      //   Phase 1: Page-side DOM traversal (PAGE session via this.sendCommand)
      //   Phase 2: OOPIF resolution (CDPProxy browser WS via send)
      //   Phase 3: Isolated world + checkbox (OOPIF session via send)
      //   Phase 4: Click (OOPIF session via send)
      // ──────────────────────────────────────────────────────────────────

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
      let iframeBackendNodeId: number | null = null;
      let iframeFrameId: string | null = null;
      let phase1Ms = 0;

      if (strategies.chromePort && active.pageTargetId) {
        const phase1Start = Date.now();
        const phase1Result = yield* strategies.phase1PageDomTraversal(active.pageTargetId);
        iframeBackendNodeId = phase1Result.backendNodeId;
        iframeFrameId = phase1Result.frameId;
        phase1Ms = Date.now() - phase1Start;
      }

      strategies.events.marker(pageCdpSessionId, 'cf.page_traversal', {
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
      const oopifSessionId = yield* strategies.phase2OOPIFResolution(
        send, pageSend, pageCdpSessionId, iframeFrameId, via,
      );

      if (!oopifSessionId) {
        const targetInfos = yield* Effect.tryPromise(() => send('Target.getTargets')).pipe(
          Effect.map(r => r?.targetInfos),
          Effect.orElseSucceed(() => []),
        );
        strategies.events.marker(pageCdpSessionId, 'cf.cdp_no_oopif', {
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
      const checkboxResult = yield* strategies.phase3CheckboxFind(
        send, oopifSessionId, pageCdpSessionId, active, via, solveStart,
      );
      if (!checkboxResult) return false;

      const { checkbox, method: cbMethod } = checkboxResult;

      // ── Phase 4: Visibility check, scroll, bounds, click ─────────────
      // No artificial delay — pydoll clicks immediately after finding the
      // checkbox. The retry loop in solveByClicking polls every 500ms which
      // naturally gives CF's WASM time to arm.
      return yield* strategies.phase4Click(
        send, oopifSessionId, pageCdpSessionId, active,
        checkbox, cbMethod, iframeBackendNodeId, via, attempt, solveStart,
      );
    }).pipe(
      Effect.catch((err: unknown) => {
        strategies.events.marker(active.pageCdpSessionId, 'cf.cdp_error', {
          error: err instanceof Error ? err.message : 'unknown',
          via: strategies.sendViaProxy ? 'proxy_ws' : 'direct_ws', attempt,
        });
        return Effect.succeed(false);
      }),
    );
  }

  // ── Phase 1: Page-side shadow root traversal (PAGE session) ──────
  // Pydoll calls find_shadow_roots(deep=False) → DOM.getDocument(depth=-1, pierce=true)
  // then checks each shadow root's inner_html for challenges.cloudflare.com,
  // then querySelector('iframe[src*="challenges.cloudflare.com"]') on the shadow root,
  // then DOM.describeNode on the iframe element to get frameId + backendNodeId.

  private phase1PageDomTraversal(
    pageTargetId: TargetId,
  ): Effect.Effect<{ backendNodeId: number | null; frameId: string | null }> {
    const strategies = this;
    return Effect.gen(function*() {
      let backendNodeId: number | null = null;
      let frameId: string | null = null;

      const cleanWsResult = yield* Effect.tryPromise(() => strategies.openCleanPageWs(pageTargetId)).pipe(
        Effect.orElseSucceed(() => null),
      );
      if (!cleanWsResult) return { backendNodeId, frameId };

      try {
        // DOM.getDocument(depth:-1, pierce:true) — C++ layer, finds shadow roots
        const doc = yield* Effect.tryPromise(() => cleanWsResult.send('DOM.getDocument', { depth: -1, pierce: true })).pipe(
          Effect.orElseSucceed(() => null),
        );
        if (doc?.root) {
          // Walk tree for iframe[src*="challenges.cloudflare.com"]
          const iframe = strategies.findCFIframeInTree(doc.root);
          if (iframe) {
            backendNodeId = iframe.backendNodeId;
            frameId = iframe.frameId ?? null;
          }
        }
      } finally {
        // Phase 1 failure is non-fatal — Phase 2 fallback handles it
        cleanWsResult.cleanup();
      }

      return { backendNodeId, frameId };
    });
  }

  // ── Phase 2: OOPIF resolution ─────────────────────────────────────

  private phase2OOPIFResolution(
    send: SendCommand,
    pageSend: SendCommand,
    pageCdpSessionId: CdpSessionId,
    iframeFrameId: string | null,
    via: string,
  ): Effect.Effect<CdpSessionId | null> {
    const strategies = this;
    return Effect.gen(function*() {
      const targetsResult = yield* Effect.tryPromise(() => send('Target.getTargets')).pipe(
        Effect.orElseSucceed(() => ({ targetInfos: [] as any[] })),
      );
      const targetInfos = targetsResult?.targetInfos;
      if (!targetInfos?.length) return null;

      // Filter out test widgets
      const candidates = targetInfos.filter(
        (t: { type: string; url?: string }) =>
          (t.type === 'iframe' || t.type === 'page')
          && t.url?.includes('challenges.cloudflare.com')
          && !isCFTestWidget(t.url),
      );

      let oopifSessionId: CdpSessionId | null = null;

      // Primary: match by frameId from page-side DOM.describeNode
      // The iframe element's frameId (from page session) matches the target's
      // frame tree root frame ID. frameId is a global Chrome identifier (unlike
      // backendNodeId which is per-connection).
      if (iframeFrameId && candidates.length > 0) {
        for (const target of candidates) {
          const trySessionId = yield* Effect.tryPromise(async () => {
            const { sessionId } = await send('Target.attachToTarget', {
              targetId: target.targetId,
              flatten: true,
            });
            return sessionId;
          }).pipe(Effect.orElseSucceed(() => null));
          if (!trySessionId) continue; // This target didn't match — try next

          const ft = yield* Effect.tryPromise(() => send('Page.getFrameTree', {}, trySessionId)).pipe(
            Effect.orElseSucceed(() => null),
          );
          const frameId = ft?.frameTree?.frame?.id;
          if (!frameId) continue; // This target didn't match — try next

          if (frameId === iframeFrameId || target.targetId === iframeFrameId) {
            oopifSessionId = trySessionId;
            strategies.events.marker(pageCdpSessionId, 'cf.oopif_discovered', {
              method: 'active', via,
              filter: 'frameId_match',
              targetId: target.targetId,
              url: target.url?.substring(0, 100),
              total_candidates: candidates.length,
            });
            break;
          }
        }
      }

      // Fallback: parentFrameId filter (if page-side traversal failed)
      // When iframeFrameId is set but frameId_match failed, the correct OOPIF
      // likely hasn't appeared in Target.getTargets yet (Chrome registers OOPIFs
      // asynchronously after the iframe element appears in the DOM). Poll for it.
      if (!oopifSessionId) {
        const maxOopifPolls = iframeFrameId ? 6 : 1; // 6 × 500ms = 3s max wait
        for (let oopifPoll = 0; oopifPoll < maxOopifPolls; oopifPoll++) {
          if (oopifPoll > 0) {
            yield* Effect.sleep('500 millis');
            // Re-fetch targets — the correct OOPIF may have appeared
            const refreshed = yield* Effect.tryPromise(() => send('Target.getTargets')).pipe(
              Effect.orElseSucceed(() => ({ targetInfos: [] as any[] })),
            );
            const refreshedCandidates = (refreshed.targetInfos ?? []).filter(
              (t: { type: string; url?: string }) =>
                (t.type === 'iframe' || t.type === 'page')
                && t.url?.includes('challenges.cloudflare.com')
                && !isCFTestWidget(t.url),
            );
            // Try frameId_match on refreshed targets
            for (const target of refreshedCandidates) {
              const trySessionId = yield* Effect.tryPromise(async () => {
                const { sessionId } = await send('Target.attachToTarget', {
                  targetId: target.targetId,
                  flatten: true,
                });
                return sessionId;
              }).pipe(Effect.orElseSucceed(() => null));
              if (!trySessionId) continue;
              const ft = yield* Effect.tryPromise(() => send('Page.getFrameTree', {}, trySessionId)).pipe(
                Effect.orElseSucceed(() => null),
              );
              const frameId = ft?.frameTree?.frame?.id;
              if (frameId && (frameId === iframeFrameId || target.targetId === iframeFrameId)) {
                oopifSessionId = trySessionId;
                strategies.events.marker(pageCdpSessionId, 'cf.oopif_discovered', {
                  method: 'active', via,
                  filter: 'frameId_match_retry',
                  targetId: target.targetId,
                  url: target.url?.substring(0, 100),
                  total_candidates: refreshedCandidates.length,
                  poll: oopifPoll,
                });
                break;
              }
            }
            if (oopifSessionId) break;
            continue;
          }

          // First poll (oopifPoll === 0): use parentFrameId filter on existing candidates
          let pageFrameId: string | null = null;
          const frameTree = yield* Effect.tryPromise(() => pageSend('Page.getFrameTree', {}, pageCdpSessionId)).pipe(
            Effect.orElseSucceed(() => null),
          );
          pageFrameId = frameTree?.frameTree?.frame?.id ?? null;

          let cfTargets = pageFrameId
            ? candidates.filter(
                (t: { parentFrameId?: string }) => t.parentFrameId === pageFrameId,
              )
            : [];

          if (cfTargets.length === 0) cfTargets = candidates;

          if (cfTargets.length > 0) {
            const target = cfTargets[0];
            const sessionId = yield* Effect.tryPromise(async () => {
              const { sessionId } = await send('Target.attachToTarget', {
                targetId: target.targetId,
                flatten: true,
              });
              return sessionId;
            }).pipe(Effect.orElseSucceed(() => null));
            if (sessionId) {
              // If we have iframeFrameId, verify this OOPIF matches before committing
              if (iframeFrameId) {
                const ft = yield* Effect.tryPromise(() => send('Page.getFrameTree', {}, sessionId)).pipe(
                  Effect.orElseSucceed(() => null),
                );
                const frameId = ft?.frameTree?.frame?.id;
                if (frameId && frameId !== iframeFrameId && target.targetId !== iframeFrameId) {
                  // Stale OOPIF — doesn't match our Phase 1 iframe. Keep polling.
                  strategies.events.marker(pageCdpSessionId, 'cf.oopif_stale', {
                    via, targetId: target.targetId,
                    expected_frame_id: (iframeFrameId as string).substring(0, 20),
                    actual_frame_id: frameId?.substring(0, 20),
                    poll: oopifPoll,
                  });
                  continue;
                }
              }
              oopifSessionId = sessionId;
              strategies.events.marker(pageCdpSessionId, 'cf.oopif_discovered', {
                method: 'active', via,
                filter: pageFrameId ? 'parentFrameId' : 'url',
                targetId: target.targetId,
                url: target.url?.substring(0, 100),
                total_candidates: cfTargets.length,
              });
              break;
            }
          }
        }
      }

      return oopifSessionId;
    });
  }

  // ── Phase 3: Checkbox finding (OOPIF session) ─────────────────────

  private phase3CheckboxFind(
    send: SendCommand,
    oopifSessionId: CdpSessionId,
    pageCdpSessionId: CdpSessionId,
    active: ActiveDetection,
    via: string,
    solveStart: number,
  ): Effect.Effect<{ checkbox: { objectId: string; backendNodeId: number }; method: string } | null> {
    const strategies = this;
    return Effect.gen(function*() {
      // Create isolated world
      let isolatedContextId: number | null = null;
      let oopifFrameId: string | null = null;
      const frameTreeResult = yield* Effect.tryPromise(() => send('Page.getFrameTree', {}, oopifSessionId)).pipe(
        Effect.orElseSucceed(() => null),
      );
      oopifFrameId = frameTreeResult?.frameTree?.frame?.id ?? null;

      if (oopifFrameId) {
        // NOTE: pydoll has a typo "grantUniveralAccess" (missing 's') which
        // Chrome ignores, so pydoll's isolated world does NOT have universal access.
        // We intentionally omit grantUniversalAccess to match pydoll's actual behavior.
        const isolatedWorld = yield* Effect.tryPromise(() => send('Page.createIsolatedWorld', {
          frameId: oopifFrameId,
          worldName: `browserless::cf::${oopifFrameId}`,
        }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
        isolatedContextId = isolatedWorld?.executionContextId ?? null;
        // Isolated world creation failed — fall through to non-isolated path
      }

      strategies.events.marker(pageCdpSessionId, 'cf.cdp_dom_session', {
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
        if (active.aborted) return null;
        pollCount = poll + 1;

        if (isolatedContextId) {
          checkbox = yield* strategies.findCheckboxViaIsolatedWorld(send, oopifSessionId, isolatedContextId);
          if (checkbox) { method = 'isolated_world'; break; }
        }

        if (!checkbox) {
          checkbox = yield* strategies.findCheckboxViaRuntimeUsing(send, oopifSessionId);
          if (checkbox) { method = 'runtime_query'; break; }
        }

        if (!checkbox) {
          const doc = yield* Effect.tryPromise(() => send('DOM.getDocument', {
            depth: -1, pierce: true,
          }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
          if (doc?.root) {
            const node = strategies.findCheckboxInTree(doc.root);
            if (node) {
              checkbox = { objectId: '', backendNodeId: node.backendNodeId };
              method = 'dom_tree_walk';
              break;
            }
          }
        }

        // Checkbox not found yet — wait and retry (matching pydoll's polling)
        yield* Effect.sleep(`${pollInterval} millis`);
      }

      if (!checkbox) {
        strategies.events.marker(pageCdpSessionId, 'cf.cdp_no_checkbox', { via, polls: pollCount });
        return null;
      }

      const checkboxFoundAt = Date.now();
      strategies.events.marker(pageCdpSessionId, 'cf.cdp_checkbox_found', {
        method, backendNodeId: checkbox.backendNodeId,
        has_objectId: !!checkbox.objectId, via, polls: pollCount,
        checkbox_found_ms: checkboxFoundAt - solveStart,
      });
      strategies.events.emitProgress(active, 'widget_found', { method, x: 0, y: 0 });

      return { checkbox, method };
    });
  }

  // ── Phase 4: Click dispatch ───────────────────────────────────────

  private phase4Click(
    send: SendCommand,
    oopifSessionId: CdpSessionId,
    pageCdpSessionId: CdpSessionId,
    active: ActiveDetection,
    checkbox: { objectId: string; backendNodeId: number },
    method: string,
    iframeBackendNodeId: number | null,
    via: string,
    attempt: number,
    solveStart: number,
  ): Effect.Effect<boolean> {
    const strategies = this;
    return Effect.gen(function*() {
      // Pydoll does a visibility check (getBoundingClientRect + getComputedStyle)
      // before clicking. This confirms the element is rendered and interactive.
      if (checkbox.objectId) {
        const visible = yield* Effect.tryPromise(() => send('Runtime.callFunctionOn', {

          objectId: checkbox.objectId,
          functionDeclaration: `function() {
            const rect = this.getBoundingClientRect();
            return (rect.width > 0 && rect.height > 0
              && getComputedStyle(this).visibility !== 'hidden'
              && getComputedStyle(this).display !== 'none');
          }`,
          returnByValue: true,
        }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));

        if (visible?.result?.value === false) {
          strategies.events.marker(pageCdpSessionId, 'cf.checkbox_not_visible', { via, polls: 0 });
          return false;
        }
      }

      // scrollIntoView
      const scrollParams = checkbox.objectId
        ? { objectId: checkbox.objectId }
        : { backendNodeId: checkbox.backendNodeId };
      yield* Effect.tryPromise(() => send('DOM.scrollIntoViewIfNeeded', scrollParams, oopifSessionId)).pipe(
        Effect.orElseSucceed(() => undefined),
      );

      // DOM.getBoxModel with getBoundingClientRect fallback
      const boxParams = checkbox.objectId
        ? { objectId: checkbox.objectId }
        : { backendNodeId: checkbox.backendNodeId };
      const box = yield* Effect.tryPromise(() => send('DOM.getBoxModel', boxParams, oopifSessionId)).pipe(
        Effect.orElseSucceed(() => null),
      );

      let x: number, y: number;
      let coordSource = 'getBoxModel';

      if (box?.model?.content) {
        const quad = box.model.content;
        x = (quad[0] + quad[2] + quad[4] + quad[6]) / 4;
        y = (quad[1] + quad[3] + quad[5] + quad[7]) / 4;
      } else if (checkbox.objectId) {
        const boundsResult = yield* Effect.tryPromise(() => send('Runtime.callFunctionOn', {
          objectId: checkbox.objectId,
          functionDeclaration: `function() {
            const r = this.getBoundingClientRect();
            return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
          }`,
          returnByValue: true,
        }, oopifSessionId)).pipe(Effect.orElseSucceed(() => null));
        const bounds = JSON.parse(boundsResult?.result?.value || '{}');
        if (!bounds.width) {
          strategies.events.marker(pageCdpSessionId, 'cf.cdp_no_box_model', { method, via });
          return false;
        }
        x = bounds.x + bounds.width / 2;
        y = bounds.y + bounds.height / 2;
        coordSource = 'getBoundingClientRect';
      } else {
        strategies.events.marker(pageCdpSessionId, 'cf.cdp_no_box_model', { method, via });
        return false;
      }

      // ── Phase 4a: Get iframe page-space position for debugging ────────
      // Translate iframe-relative click coords → page-absolute coords
      // so the replay shows WHERE on the page the click should appear.
      // Non-fatal — page coords just won't be available if this fails.
      let iframePageX: number | null = null;
      let iframePageY: number | null = null;
      if (iframeBackendNodeId && strategies.chromePort && active.pageTargetId) {
        const iframeCoords = yield* strategies.getIframePageCoords(active.pageTargetId, iframeBackendNodeId);
        iframePageX = iframeCoords.x;
        iframePageY = iframeCoords.y;
      }

      const clickX = Math.round(x);
      const clickY = Math.round(y);

      // Page-absolute coordinates (iframe origin + click offset within iframe)
      const pageAbsX = iframePageX != null ? Math.round(iframePageX + clickX) : null;
      const pageAbsY = iframePageY != null ? Math.round(iframePageY + clickY) : null;

      strategies.events.marker(pageCdpSessionId, 'cf.cdp_click_target', {
        x: clickX, y: clickY,
        method, via, coordSource,
        page_x: pageAbsX,
        page_y: pageAbsY,
        iframe_origin_x: iframePageX != null ? Math.round(iframePageX) : null,
        iframe_origin_y: iframePageY != null ? Math.round(iframePageY) : null,
        had_phase1_iframe: !!iframeBackendNodeId,
      });

      // ── Phase 4b: Dispatch click with mouseMoved + response capture ──
      // Send a mouseMoved BEFORE the press/release. Without this, Chrome receives
      // a bare mousePressed at coordinates it hasn't seen the cursor move to —
      // the compositor may not route the event to the correct renderer process.
      // This also makes the click visible in rrweb recordings (the extension inside
      // the OOPIF captures mousemove DOM events, so the replay shows cursor movement).
      yield* Effect.tryPromise(() => send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: clickX, y: clickY,
        button: 'none',
      }, oopifSessionId));
      yield* Effect.sleep(`${20 + Math.random() * 30} millis`);

      const pressResponse = yield* Effect.tryPromise(() => send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: clickX, y: clickY,
        button: 'left', clickCount: 1,
      }, oopifSessionId));
      const holdMs = 50 + Math.random() * 100;
      yield* Effect.sleep(`${holdMs} millis`);
      const releaseResponse = yield* Effect.tryPromise(() => send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: clickX, y: clickY,
        button: 'left', clickCount: 1,
      }, oopifSessionId));

      // Track click delivery for solve attribution
      active.clickDelivered = true;
      active.clickDeliveredAt = Date.now();
      strategies.events.emitProgress(active, 'clicked', { x: clickX, y: clickY });

      strategies.events.marker(pageCdpSessionId, 'cf.oopif_click', {
        ok: true, method: 'cdp_oopif_session', via, attempt,
        x: clickX, y: clickY,
        page_x: pageAbsX,
        page_y: pageAbsY,
        hold_ms: Math.round(holdMs),
        press_response: pressResponse ? JSON.stringify(pressResponse).substring(0, 100) : 'empty',
        release_response: releaseResponse ? JSON.stringify(releaseResponse).substring(0, 100) : 'empty',
        oopif_session_id: oopifSessionId.substring(0, 16),
        elapsed_since_solve_start_ms: Date.now() - solveStart,
        checkbox_to_click_ms: Date.now() - solveStart,
      });
      return true;
    }).pipe(
      Effect.catch(() => Effect.succeed(false)),
    );
  }

  // ── Helper: get iframe page-space coordinates ─────────────────────

  private getIframePageCoords(
    pageTargetId: TargetId,
    iframeBackendNodeId: number,
  ): Effect.Effect<{ x: number | null; y: number | null }> {
    const strategies = this;
    return Effect.gen(function*() {
      const cleanWs = yield* Effect.tryPromise(() => strategies.openCleanPageWs(pageTargetId)).pipe(
        Effect.orElseSucceed(() => null),
      );
      if (!cleanWs) return { x: null, y: null };

      try {
        const iframeBox = yield* Effect.tryPromise(() => cleanWs.send('DOM.getBoxModel', {
          backendNodeId: iframeBackendNodeId,
        })).pipe(Effect.orElseSucceed(() => null));
        if (iframeBox?.model?.content) {
          const q = iframeBox.model.content;
          // content quad: [x0,y0, x1,y1, x2,y2, x3,y3] — top-left origin is q[0],q[1]
          return { x: q[0] as number, y: q[1] as number };
        }
        return { x: null, y: null };
      } finally {
        cleanWs.cleanup();
      }
    });
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
  private async openCleanPageWs(targetId: TargetId): Promise<{
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
   * Returns Effect.
   *
   * WARNING: Do NOT upgrade this to use DOM.getDocument or Runtime.evaluate —
   * even on a fresh clean-page WS connection. The detection polling loop runs
   * 20 polls x 200ms, and repeated page-level CDP calls during that window
   * trigger CF's WASM fingerprint checks, causing rechallenges on every click.
   * Proven 2026-02-24: Target.getTargets = 5/5 pass, DOM.getDocument = timeout,
   * Runtime.evaluate = rechallenge. Target.getTargets is browser-level and
   * completely invisible to the page.
   */
  detectTurnstileViaCDP(_pageCdpSessionId: CdpSessionId): Effect.Effect<CFDetectionResult | null> {
    const strategies = this;
    return Effect.gen(function*() {
      const send = strategies.sendViaProxy || strategies.sendCommand;
      const result = yield* Effect.tryPromise(
        () => send('Target.getTargets', {}, undefined, 5_000),
      ).pipe(Effect.orElseSucceed(() => null));
      if (!result?.targetInfos?.length) return { present: false };

      const hasCFIframe = result.targetInfos.some(
        (t: { type: string; url?: string }) =>
          (t.type === 'iframe' || t.type === 'page')
          && t.url?.includes('challenges.cloudflare.com')
          && !isCFTestWidget(t.url),
      );
      return { present: hasCFIframe };
    });
  }

  /**
   * Check Turnstile OOPIF state via CDP DOM walk.
   * Replaces the MutationObserver + __turnstileStateBinding injection.
   * Returns Effect.
   *
   * Inspects the OOPIF's DOM tree for state indicator elements:
   * - #success (display !== none) → 'success'
   * - #fail → 'fail'
   * - #expired → 'expired'
   * - #timeout → 'timeout'
   * - #verifying → 'verifying' (mapped to 'pending')
   * - none visible → 'pending'
   */
  checkOOPIFStateViaCDP(iframeCdpSessionId: CdpSessionId): Effect.Effect<
    'success' | 'fail' | 'expired' | 'timeout' | 'pending' | null
  > {
    const strategies = this;
    return Effect.gen(function*() {
      const doc = yield* Effect.tryPromise(
        () => strategies.sendCommand('DOM.getDocument', { depth: -1, pierce: true }, iframeCdpSessionId),
      ).pipe(Effect.orElseSucceed(() => null));

      if (!doc?.root) return null;

      return strategies.findStateInOOPIFTree(doc.root);
    });
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
