# Cloudflare Solver — Browserless Server-Side Reference

The browserless server-side CF solver detects and solves Cloudflare challenges without any client (pydoll) involvement. This doc covers the **server-side solver only** — for client-side Turnstile bypass via pydoll, see the pydoll source code in `pydoll/browser/tab.py`.

## Architecture

```
Browserless (producer)              Pydoll (consumer)
─────────────────────               ─────────────────
CloudflareSolver (delegator)        cloudflare_listener.py
  ├─ CloudflareDetector               ├─ CloudflareListener
  │   └─ detect challenge              ├─ Waiter (accumulates events)
  ├─ CloudflareSolveStrategies        ├─ Result (aggregated outcome)
  │   ├─ find + click widget           ├─ Wide events + metrics
  │   └─ verify solve                  └─ Diagnostic capture on failure
  ├─ CloudflareStateTracker
  │   └─ active detections, tokens
  └─ CloudflareEventEmitter
      └─ emit CDP events ──────────────>
           + recording markers
```

**Boundary:** Browserless produces structured CDP events and recording markers. Pydoll consumes them into wide events, metrics, and diagnostics. Observability logic lives in pydoll, not browserless.

The solver intercepts CDP traffic flowing through browserless. When a page navigates to a CF challenge, the solver detects it, waits, discovers the Turnstile OOPIF, and clicks the checkbox — all transparently. Pydoll sees a normal page load.

---

## THE Critical Rule — Root Cause of All Failures

> **NEVER call `Runtime.evaluate` on a CF challenge page before clicking.**

This is the single most important rule in the entire solver. This rule is more important than everything else in this document combined.

### What Happened

The old solver called `isSolved()` at 4+ points **before** clicking. Each call used `Runtime.evaluate` on the page session to check:
- `window.__turnstileSolved`
- `turnstile.getResponse()`
- `document.querySelector('input[name="cf-turnstile-response"]').value`

CF's WASM monitors V8 evaluation events in the page context. Even a single `Runtime.evaluate('document.title')` on the page session **poisons the entire session forever** — CF rejects ALL subsequent clicks, no matter how perfectly they're delivered.

### The Fix

**Remove those `isSolved()` calls.** That's it. Not fingerprint cleanup, not screenX patches, not xdotool XTEST events, not CDP disconnect/reconnect. Those were all secondary. The moment we stopped calling `Runtime.evaluate` on the page before clicking, solve rate went from **0% to 100%**.

### A/B Test Proof (2026-02-23)

| Approach | Result |
|----------|--------|
| `Runtime.evaluate(CF_DETECTION_JS)` before click | **0% solve rate** — CF reloads challenge endlessly |
| Zero-injection (URL match + DOM walk) before click | **100% solve rate** — 3/3 on nopecha, 3-5s solve time |

### Post-Click Exception

`isSolved()` and `getToken()` in `CloudflareStateTracker` still use `Runtime.evaluate`. They are **only** called after the click succeeds and CF has already accepted the solve. At that point, V8 evaluation doesn't matter — the challenge is already passed.

### Rule 2: Never Execute JS on the Page Through ReplaySession's WS

ReplaySession's WS connection has accumulated V8 state from recording setup — `Page.addScriptToEvaluateOnNewDocument` for rrweb, `Runtime.addBinding` for `__csrfp` and `__perf`. When `Runtime.callFunctionOn` executes in this tainted context, CF's WASM detects the modifications.

Pydoll does its Phase 1 commands through a fresh `/devtools/page/{targetId}` WS. That connection has zero accumulated state — clean V8.

**Phase 1 is now re-enabled via a clean page WS.** The solver opens a fresh `/devtools/page/{targetId}` WS (matching pydoll's approach) for Phase 1's `DOM.getDocument(depth:-1, pierce:true)` traversal. This WS is created per-detection attempt, used only for the DOM walk, and immediately closed. Zero V8 state accumulation.

If `chromePort` is unavailable, Phase 1 gracefully skips and Phase 2's `parentFrameId` fallback handles OOPIF discovery.

#### WS Routing and V8 State

| Path | Endpoint | V8 State | CF Safe? |
|------|----------|----------|----------|
| Phase 1 (page DOM walk) | Fresh `/devtools/page/{targetId}` WS | Clean (new per-detection) | Yes |
| Pydoll page commands | `/devtools/page/{targetId}` (http-proxy tunnel) | Clean | Yes |
| ReplaySession commands | Internal direct WS | Tainted (rrweb, bindings) | **NO** for JS execution |
| `sendViaProxy` (solver) | `/devtools/browser/{id}` (CDPProxy) | N/A (browser-level) | Yes |
| OOPIF commands (both) | OOPIF sessionId on any WS | Separate V8 isolate | Yes |

---

## Pydoll vs Browserless — Complete Comparison

Pydoll's `_bypass_cloudflare` (tab.py:1945-1966) was the working reference. We copied it to TypeScript in browserless. Below is every step compared, with every difference explicitly called out.

### Side-by-Side Comparison Table

| Step | Pydoll (Python) | Browserless (TypeScript) | Same? |
|------|--------|-------------|-------|
| **Phase 1 (page DOM walk)** | `DOM.getDocument(depth=-1, pierce=True)` → shadow root `inner_html` check for CF iframe. Uses fresh `/devtools/page/` WS (clean V8) | `DOM.getDocument(depth=-1, pierce=true)` → tree walk for CF iframe. Uses fresh `/devtools/page/` WS (clean V8, matching pydoll) | **SAME** — both use clean page WS for Phase 1 |
| **Detection** | Shadow root inner_html matching from Phase 1 | URL pattern matching (`detectCFFromUrl`) OR `Target.getTargets` (browser-level, zero page V8) | **DIFFERENT** — browserless uses URL matching + `Target.getTargets`; pydoll uses DOM walk |
| **Pre-click isSolved()** | No | No (explicitly removed) | Same |
| **OOPIF connection** | `ConnectionHandler(connection_port=port)` — brand new WS to Chrome | `sendViaProxy` — routes through CDPProxy's browser WS (opaque byte tunnel) | **DIFFERENT** — pydoll creates fresh WS; browserless reuses CDPProxy's browser WS |
| **OOPIF discovery filter** | `Target.getTargets` → filter by `parentFrameId` match | `Target.getTargets` → filter by frameId match, fallback to `parentFrameId` | Same (browserless now matches pydoll's `parentFrameId` approach) |
| **Frame validation** | `Page.getFrameTree(sessionId)` → validate frame identity via `owner_backend_id` | `Page.getFrameTree(sessionId)` → validate frame identity | Same |
| **Isolated world** | `Page.createIsolatedWorld(frameId, 'pydoll::iframe::...', grantUniversalAccess=True)` → get `executionContextId` | `Page.createIsolatedWorld(frameId, worldName, grantUniversalAccess=true)` → get `executionContextId` | Same |
| **Get document** | `Runtime.evaluate('document.documentElement', contextId=isolatedWorld)` **in isolated world** | `Runtime.evaluate('document.documentElement', contextId=isolatedWorld)` **in isolated world** (primary method) | Same |
| **Find checkbox** | `Runtime.callFunctionOn(querySelector('span.cb-i'))` on shadow objectId in isolated world | Three methods tried in order: isolated world → runtime query → DOM tree walk. Polls 8× at 500ms | **DIFFERENT** — browserless has polling + multiple fallback strategies |
| **Coordinates** | `DOM.getBoxModel` → center, **fallback to `getBoundingClientRect()` JS** | `DOM.getBoxModel` → center, **fallback to `getBoundingClientRect()` JS** | Same |
| **Pre-click wait** | None | 2000ms minimum elapsed since solve start (WASM arming delay) | **DIFFERENT** — browserless waits for CF WASM to arm |
| **Mouse movement** | Bezier curve via `Mouse.click()` (`humanize=True`) — moves from tracked position to target | None — teleports directly to coordinates | **DIFFERENT** — pydoll humanizes mouse; browserless teleports |
| **Click dispatch** | `Input.dispatchMouseEvent` press + 100ms sleep + release via OOPIF sessionId | `Input.dispatchMouseEvent` press + 50-150ms sleep + release via oopifSessionId | Same pattern |
| **Click attribution** | Not tracked | `clickDelivered` flag → `click_navigation` vs `auto_navigation` method in `cf.solved` | **DIFFERENT** — browserless tracks click → navigation causality |

### Why `Page.createIsolatedWorld` Matters

Pydoll's `IFrameContextResolver` calls `Page.createIsolatedWorld(frameId)` to create an **isolated execution context** in the OOPIF frame. Isolated worlds share the DOM but have **completely separate JavaScript globals** — like Chrome extension content scripts. Any detection code running in the main world (including CF's own code within the Turnstile iframe) **CANNOT observe JS execution in an isolated world**.

```python
# pydoll/interactions/iframe.py:319-337
create_command = PageCommands.create_isolated_world(
    frame_id=frame_id,
    world_name=f'pydoll::iframe::{frame_id}',
    grant_universal_access=True,
)
create_command['sessionId'] = session_id
create_response = await handler.execute_command(create_command)
execution_context_id = create_response['result']['executionContextId']
```

Then ALL subsequent `Runtime.evaluate` and `Runtime.callFunctionOn` calls use this `executionContextId`. They are invisible to any code in the main world.

Browserless now does the same — `Page.createIsolatedWorld` on the OOPIF frame, then all `Runtime.evaluate` and `Runtime.callFunctionOn` calls use the isolated `executionContextId`. This matches pydoll's defensive approach: even though CF's WASM runs in the **page's** V8 (not the OOPIF's), the isolated world provides an extra layer of protection against any future OOPIF-level detection.

### Pydoll's Full Call Chain

```
Tab._bypass_cloudflare()
  ├─ _find_cloudflare_shadow_root()
  │    └─ DOM.getDocument(depth=-1, pierce=True) → walk tree for shadowRoots
  │         └─ check inner_html for 'challenges.cloudflare.com'
  ├─ shadow_root.query('iframe[src*="challenges.cloudflare.com"]')
  ├─ iframe.find(tag_name='body')  ← triggers IFrameContextResolver
  │    └─ IFrameContextResolver.resolve()
  │         ├─ ConnectionHandler(connection_port=port)     ← NEW WS
  │         ├─ Target.getTargets()                         ← find all targets
  │         ├─ filter by parentFrameId                     ← match iframe
  │         ├─ Target.attachToTarget(flatten=True)         ← get OOPIF sessionId
  │         ├─ Page.getFrameTree(sessionId)                ← validate frame
  │         ├─ Page.createIsolatedWorld(frameId)           ← ISOLATED JS CONTEXT
  │         └─ Runtime.evaluate('document.documentElement', contextId=isolated)
  ├─ body.get_shadow_root()
  │    └─ DOM.describeNode(pierce=true) + DOM.resolveNode
  ├─ inner_shadow.query('span.cb-i')
  │    └─ Runtime.callFunctionOn(querySelector) on shadow objectId
  └─ checkbox.click()
       ├─ DOM.getBoxModel → center (fallback: getBoundingClientRect JS)
       ├─ [humanize] Bezier mouse movement to target
       └─ Input.dispatchMouseEvent (press + 100ms + release) via OOPIF sessionId
```

### Browserless Current Call Chain

```
cloudflare-detector.ts:
  ├─ detectCFFromUrl()                                ← URL pattern (zero CDP)
  └─ detectTurnstileViaCDP()
       └─ Target.getTargets()                         ← browser-level, zero page V8
            └─ filter for url.includes('challenges.cloudflare.com')

cloudflare-solve-strategies.ts:
  ├─ solveByClicking() / solveTurnstile()
  │    └─ sleep(rand(2000, 4000))                     ← NO isSolved() here
  └─ findAndClickViaCDP()
       ├─ Phase 1: Page-side DOM walk (CLEAN page WS)
       │    ├─ openCleanPageWs(pageTargetId)           ← fresh /devtools/page/ WS (zero V8 state)
       │    ├─ DOM.getDocument(depth=-1, pierce=true)  ← C++ layer, walks shadow roots
       │    ├─ findCFIframeInTree(root)                ← recursive walk for CF iframe
       │    ├─ extract: iframeBackendNodeId, iframeFrameId
       │    ├─ cleanup: close WS immediately
       │    └─ marker: cf.page_traversal {skipped_phase1: false, iframe_frame_id}
       ├─ Phase 2: OOPIF discovery via sendViaProxy   ← CDPProxy browser WS (not isolated WS)
       │    ├─ Target.getTargets → filter frameId match, fallback parentFrameId
       │    ├─ Target.attachToTarget(flatten=true)     ← get oopifSessionId
       │    ├─ Page.getFrameTree(sessionId)            ← validate frame (matches pydoll)
       │    └─ marker: cf.oopif_discovered {method, via: 'proxy_ws'}
       ├─ Phase 3: Isolated world + checkbox
       │    ├─ Page.createIsolatedWorld(frameId)       ← isolated JS context (matches pydoll)
       │    ├─ marker: cf.cdp_dom_session {executionContextId}
       │    └─ Checkbox polling (8 × 500ms, 3 find methods):
       │         ├─ isolated_world: Runtime.evaluate in isolated context
       │         ├─ runtime_query: Runtime.callFunctionOn on shadow objectId
       │         └─ dom_tree_walk: DOM.getDocument tree walk
       │    └─ marker: cf.cdp_checkbox_found {method, backendNodeId}
       ├─ Phase 4: Click
       │    ├─ Wait for 2000ms minimum elapsed         ← WASM arming delay
       │    │    └─ marker: cf.waiting_for_wasm {wait_ms}
       │    ├─ Visibility check via getBoundingClientRect
       │    ├─ DOM.scrollIntoViewIfNeeded
       │    ├─ DOM.getBoxModel → center coords (fallback: getBoundingClientRect)
       │    ├─ [NO Bezier mouse movement]              ← teleports directly
       │    └─ Input.dispatchMouseEvent (press + 50-150ms + release) via oopifSessionId
       │         ├─ active.clickDelivered = true       ← click attribution flag
       │         └─ marker: cf.oopif_click {ok, method, x, y}
       └─ Post-click: navigation or token detection
            ├─ cf.click_to_nav {click_to_nav_ms}       ← ms between click and navigation
            └─ cf.solved {method: 'click_navigation' | 'auto_navigation'}
```

### Pydoll OOPIF Patch (Browserless Adapter)

`pydoll-scraper/src/evasion/pydoll_oopif_patch.py` patches pydoll to work through the Browserless WebSocket proxy:

| Patch | What It Does |
|-------|-------------|
| `_resolve_oopif_by_parent` | Uses `_browser_handler` (browser-level WS through CDPProxy) instead of creating new `ConnectionHandler(port)` — because `_connection_port` is `None` when connecting via proxy |
| `_collect_oopif_shadow_roots` | Same `_browser_handler` routing for shadow root collection |
| `_bypass_cloudflare` | Emits `Browserless.addReplayMarker` at each solve step for recording visibility |
| `new_tab` | Propagates `_browser_handler` from Chrome to every new tab |

---

## Files

### Solver modules — `browserless/src/session/cf/`

| File | Lines | Responsibility |
|------|-------|----------------|
| `cloudflare-detector.ts` | ~338 | Detection lifecycle: `onPageAttached`, `onPageNavigated`, `onIframeAttached`, URL pattern matching, `Target.getTargets` check, click attribution (`click_navigation` vs `auto_navigation`) |
| `cloudflare-solve-strategies.ts` | ~956 | Solve execution: `sendViaProxy` routing, OOPIF discovery (frameId + parentFrameId), `Page.createIsolatedWorld`, checkbox polling (8×500ms, 3 methods), 2s WASM wait, click dispatch, `detectTurnstileViaCDP` via `Target.getTargets` |
| `cloudflare-state-tracker.ts` | ~332 | Active detection state, solved tracking, background activity loops, post-click `isSolved`/`getToken`, `clickDelivered`/`clickDeliveredAt` tracking |
| `cloudflare-event-emitter.ts` | ~221 | `CloudflareTracker` + CDP event emission + recording markers (`cf.click_to_nav`, `cf.waiting_for_wasm`, `cf.page_traversal`) |

### Session modules — `browserless/src/session/`

| File | Role |
|------|------|
| `cloudflare-solver.ts` | Thin delegator — wires the four modules together, exposes public API |
| `replay-session.ts` | Core session: CDP WS proxy, rrweb injection, event collection |
| `replay-coordinator.ts` | Creates ReplaySession + CloudflareSolver per browser session |
| `target-state.ts` | `TargetState` + `TargetRegistry` (dual-indexed by targetId/cdpSessionId) |

### Shared types — `browserless/src/shared/`

| File | Role |
|------|------|
| `cloudflare-snapshot.schema.json` | JSON Schema source of truth (21 fields) |
| `cloudflare-snapshot.generated.ts` | Auto-generated TS interface — do NOT edit |
| `cloudflare-detection.ts` | `CF_DETECTION_JS` (post-click only), re-exports `CloudflareSnapshot` type |
| `mouse-humanizer.ts` | Mouse presence simulation, Bezier movement |

### Client-side — `pydoll-scraper/src/`

| File | Role |
|------|------|
| `cf_snapshot.py` | Generated Pydantic v2 model from JSON Schema |
| `cf_phase.py` | `CFPhaseSnapshot` — frozen per-phase wrapper |
| `cloudflare_listener.py` | `_Waiter` with per-phase snapshots, coordination/accumulation state split |
| `evasion/pydoll_oopif_patch.py` | Patches pydoll for Browserless proxy (OOPIF resolver, replay markers, new_tab propagation) |

### Key external references

| File | Role |
|------|------|
| `browserless/src/cdp-proxy.ts` | CDPProxy browser WS — opaque byte tunnel used by `sendViaProxy` for OOPIF commands. Also contains legacy `createIsolatedConnection()` factory |

---

## Detection — Zero-Injection Approach

No `Runtime.evaluate`, no `addScriptToEvaluateOnNewDocument`, no `Runtime.addBinding` on the CF challenge page before clicking. Three detection paths:

### Path 1: URL Pattern Matching (instant, zero CDP)

Pure string analysis in `detectCFFromUrl`. Fires on `onPageAttached` and `onPageNavigated`.

| Signal | Example |
|--------|---------|
| Hostname | `challenges.cloudflare.com` |
| Pathname | `/cdn-cgi/challenge-platform/` |
| Query param | `__cf_chl_rt_tk=` (retry token) |
| Query param | `__cf_chl_f_tk=` (form token) |
| Query param | `__cf_chl_jschl_tk__=` (legacy JS challenge) |

### Path 2: Browser-Level Target Check (for embedded Turnstile on clean URLs)

`detectTurnstileViaCDP` uses `Target.getTargets()` at the browser level to check if any iframe targets have URLs containing `challenges.cloudflare.com`. This is a single browser-level command with **zero page V8 interaction**.

Sets `detectionMethod: 'cdp_dom_walk'` (name preserved for compatibility).

**Why this changed (2026-02-24 regression):** An attempted upgrade replaced `Target.getTargets` with a clean-page-WS approach: `openCleanPageWs()` → `DOM.getDocument(depth:-1, pierce:true)` → tree walk, plus `Runtime.evaluate` for `_cf_chl_opt` type classification. Even on a fresh `/devtools/page/` WS with zero accumulated state:
- `Runtime.evaluate` during the detection polling loop (20 polls × 200ms) → **rechallenge** (CF WASM detects V8 evaluation)
- `DOM.getDocument` alone during the detection polling loop → **timeout** (19 events, never solved in 30s)

The detection polling loop runs repeatedly while waiting for the Turnstile iframe to appear. This high-frequency page-level interaction during detection — even via C++ layer commands — is visible to CF. `DOM.getDocument` is safe as a **single call** during Phase 1 of clicking, but **NOT safe when called 20 times during detection**.

`Target.getTargets` is the only safe detection method. It operates at the browser level with zero page interaction.

**Pydoll's approach:** `_find_cloudflare_shadow_root` uses `DOM.getDocument(depth=-1, pierce=True)` → walks shadow roots → checks `inner_html` for `challenges.cloudflare.com`. This works for pydoll because it runs once per solve attempt, not in a polling loop.

### Path 3: OOPIF Target Events

`onIframeAttached` and `onIframeNavigated` handle `Target.targetInfoChanged` for iframe targets. If the iframe URL includes `challenges.cloudflare.com`, the iframe session is attached to the active detection.

---

## Solve Flow

```
URL match / Target.getTargets / OOPIF event
        │
        ▼
  Detection triggered
        │
        ▼
  Wait rand(2000, 4000)ms          ← NO isSolved() here
        │
        ▼
  Phase 1: Page-side DOM walk       ← fresh /devtools/page/ WS (clean V8)
  DOM.getDocument(depth=-1, pierce) ← C++ layer, finds shadow roots
  findCFIframeInTree(root)          ← get iframeBackendNodeId + iframeFrameId
  cleanup: close WS                 ← zero state accumulation
        │
        ▼
  Phase 2: OOPIF discovery          ← sendViaProxy (CDPProxy browser WS)
  Target.getTargets → filter        ← frameId match, fallback parentFrameId
  Target.attachToTarget(targetId)   ← Get fresh oopifSessionId
  Page.getFrameTree(sessionId)      ← Validate frame identity
        │
        ▼
  Phase 3: Isolated world + checkbox
  Page.createIsolatedWorld(frameId) ← Isolated JS context (matches pydoll)
  Poll checkbox (8 × 500ms)         ← isolated_world → runtime_query → dom_tree_walk
        │
        ▼
  Phase 4: Click
  Wait for 2000ms min elapsed       ← WASM arming delay
  DOM.scrollIntoViewIfNeeded
  DOM.getBoxModel → center coords   ← fallback: getBoundingClientRect
  Input.dispatchMouseEvent           ← press + 50-150ms + release on OOPIF session
  active.clickDelivered = true       ← click attribution tracking
        │
        ▼
  Page navigates away (interstitial) or token appears (embedded)
        │
        ▼
  onPageNavigated → emit cf.solved
  method: click_navigation           ← if clickDelivered
  method: auto_navigation            ← if CF auto-solved
  cf.click_to_nav {ms}               ← timing between click and navigation
```

### By Challenge Type

| Type | Flow |
|------|------|
| `interstitial` | URL detection → `solveByClicking` → click → page navigates → `cf.solved` (method: `click_navigation` if our click triggered it, `auto_navigation` if CF auto-solved) |
| `turnstile` | `Target.getTargets` detection → `solveTurnstile` → click attempts (6×) → token polling via `turnstile.getResponse()` (safe post-detection) → `cf.solved` via `token_poll` or `beacon_push` |
| `non_interactive` / `invisible` | Detection → `simulateHumanPresence` only → no click → background loop checks `isSolved()` |
| `block` | CF error page — not solvable |

---

## OOPIF Discovery

The solver routes OOPIF commands through `sendViaProxy` — CDPProxy's browser-level WS. This is a clean, untainted connection that never accumulates page-level V8 state. Unlike ReplaySession's direct WS (which has rrweb scripts and bindings), CDPProxy is an opaque byte tunnel.

```typescript
// In findAndClickViaCDP (cloudflare-solve-strategies.ts)

// 1. Use CDPProxy's browser WS (not isolated WS, not ReplaySession's WS)
const rawSend = this.sendViaProxy || this.sendCommand;
const via = this.sendViaProxy ? 'proxy_ws' : 'direct_ws';

// 2. Discover CF iframe — frameId match first, fallback parentFrameId
const { targetInfos } = await rawSend('Target.getTargets');
const cfIframe = targetInfos.find(t =>
  t.type === 'iframe' && t.url?.includes('challenges.cloudflare.com')
);

// 3. Attach to get fresh session ID
const { sessionId: oopifSessionId } = await rawSend(
  'Target.attachToTarget', { targetId: cfIframe.targetId, flatten: true }
);

// 4. Validate frame via getFrameTree (matches pydoll)
const { frameTree } = await rawSend('Page.getFrameTree', {}, oopifSessionId);

// 5. Create isolated world (matches pydoll)
const { executionContextId } = await rawSend('Page.createIsolatedWorld', {
  frameId: frameTree.frame.id, worldName: '...', grantUniversalAccess: true
}, oopifSessionId);

// 6. All subsequent commands use oopifSessionId + executionContextId
```

### Why passive auto-attach fails for same-origin interstitials

Browser-level `Target.setAutoAttach` with `waitForDebuggerOnStart: true` pauses ALL new targets, including iframe targets. Chrome doesn't always fire `attachedToTarget` for iframes on the browser-level session, so nobody resumes them, and the paused iframe blocks the page's `load` event.

Active discovery via `Target.getTargets` + `Target.attachToTarget` avoids this — it's a pull model that doesn't pause anything.

---

## What's Safe vs Detected

### Safe CDP commands (do not trigger CF detection)

| Command | Scope | Why Safe |
|---------|-------|----------|
| `DOM.getDocument` | Page or OOPIF | C++ layer, bypasses V8. **Safe as single call (Phase 1 clicking). NOT safe in polling loops (detection) — repeated calls trigger CF timeout.** |
| `DOM.getDocument(pierce:true)` | Page or OOPIF | Same C++ layer — `pierce` walks shadow roots in C++. Same polling caveat as above. |
| `DOM.resolveNode` | OOPIF | C++ layer |
| `DOM.describeNode` | OOPIF | C++ layer, pierce=true for shadow roots |
| `DOM.getBoxModel` | OOPIF | C++ layer |
| `DOM.scrollIntoViewIfNeeded` | OOPIF | C++ layer |
| `Runtime.callFunctionOn` | **OOPIF only** | Executes in iframe's V8, not page's V8 |
| `Runtime.evaluate` | **OOPIF isolated world only** | Isolated worlds have separate JS globals — invisible to main world |
| `Target.getTargets` | Browser scope | No page context |
| `Target.attachToTarget` | Browser scope | No page context |
| `Page.getFrameTree` | OOPIF session | No page V8 execution |
| `Page.createIsolatedWorld` | OOPIF session | Creates context, no V8 execution |
| `Input.dispatchMouseEvent` | OOPIF session | Input events, no JS |

### Detected — NEVER use on CF challenge page before clicking

| Command | Scope | Why Dangerous |
|---------|-------|---------------|
| `Runtime.evaluate` | Page session | Executes in the PAGE's V8 context. CF's WASM monitors V8 evaluation events. Even `document.title` triggers detection. In a detection polling loop, causes rechallenge. |
| `DOM.getDocument` (polling) | Page session (repeated) | Safe as a single call, but repeated calls in a detection polling loop (20×200ms) cause CF timeout — the widget never solves. Proven 2026-02-24. |
| `Runtime.callFunctionOn` | Page session through tainted WS | When the WS has accumulated V8 state from recording setup (rrweb scripts, `Runtime.addBinding`), callFunctionOn inherits that tainted context. This is why Phase 1 (page-side shadow root walk) was detected through ReplaySession's WS but works through pydoll's clean WS. |
| `Runtime.addBinding` | Page session | Creates a callable function in the page's V8 context. May be enumerable. |
| `Page.addScriptToEvaluateOnNewDocument` | Page session | Injects JS that runs on page load. CF may detect injection traces. Also taints the WS connection's V8 state for all subsequent commands. |

**The V8 context boundary:** CF's WASM runs in the main page's V8 context. Anything that touches the page's V8 is visible to it. The OOPIF (Turnstile iframe) runs in a **separate V8 isolate** — JS execution there is invisible to the page. `DOM.*` commands use Chrome's C++ DOM implementation, never entering V8 at all. Isolated worlds (via `Page.createIsolatedWorld`) share the DOM but have **separate JS globals** — code in the main world cannot observe execution in an isolated world.

**The WS tainting trap:** Even commands that are inherently safe (like `Runtime.callFunctionOn` on an OOPIF) can become dangerous if sent through a WS that has accumulated V8 state from recording injections. The WS connection itself becomes a vector — not because of what you're doing now, but because of what was done through that connection earlier. This is why the solver uses `sendViaProxy` (CDPProxy's browser WS) instead of ReplaySession's direct WS.

---

## Challenge Types

Six types classified by `CloudflareDetector`:

| Type | Source | Click Needed | Detection |
|------|--------|-------------|-----------|
| `managed` | `_cf_chl_opt.cType` | Usually yes | Post-click classification only |
| `non_interactive` | `_cf_chl_opt.cType` | No | Post-click classification only |
| `invisible` | `_cf_chl_opt.cType` | No | Post-click classification only |
| `interstitial` | URL params + DOM heuristics | Yes | URL pattern match |
| `turnstile` | CF iframe in DOM | Try click | DOM walk |
| `block` | CF error page DOM | Not solvable | DOM walk |

Note: `_cf_chl_opt` is only read post-click via `CF_DETECTION_JS` in background loops. Pre-click, the solver uses URL patterns and DOM structure only.

---

## CDP Events Emitted

The solver emits custom CDP events consumed by pydoll's `CloudflareListener`:

| Event | Payload | When |
|-------|---------|------|
| `Browserless.challengeDetected` | `{type, url, iframeUrl?, cType?, cRay?, detectionMethod}` | Challenge detected |
| `Browserless.challengeProgress` | `{state, elapsed_ms, attempt, ...extra?}` | Solver lifecycle + state changes |
| `Browserless.challengeSolved` | `{solved, type, method, token?, duration_ms, attempts, auto_resolved?, signal?}` | Challenge solved |
| `Browserless.challengeFailed` | `{reason, duration_ms, attempts}` | All attempts exhausted |

These are injected into the CDP stream between browserless and pydoll. Pydoll's `_Waiter` collects them into per-phase `CFPhaseSnapshot` objects (frozen Pydantic models).

**`state` values in `challengeProgress`:**

| State | Source |
|-------|--------|
| `verifying` | Iframe state observer |
| `success` | Iframe state observer |
| `fail` | Iframe state observer |
| `expired` | Iframe state observer |
| `timeout` | Iframe state observer |
| `idle` | Iframe state observer |
| `widget_found` | Click target located |
| `clicked` | Click committed |
| `widget_error` | Error/expired widget detected |
| `false_positive` | Success reported but challenge still present |

**`method` values in `challengeSolved`:**
- `click_navigation` — our click was delivered (`clickDelivered=true`) and page subsequently navigated away from CF URL
- `auto_navigation` — page navigated away from CF URL without our click (CF auto-solved)
- `auto_solve` — token present (callback or input)
- `state_change` — iframe reported success but no token extracted

**`signal` values in `challengeSolved` (when `auto_resolved=true`):**
- `presence_phase` — solved during initial presence simulation
- `click_cancelled` — solved during approach (click not committed)
- `activity_poll` — solved during background activity loop polling
- `token_poll` — solved via `turnstile.getResponse()` polling in `solveTurnstile` (post-click or post-click-failure wait)
- `callback_binding` — `__turnstileSolvedBinding` fired
- `session_close` — fallback emit for unresolved detections at session cleanup

---

## Recording Markers

Injected into replay recordings for debugging. All prefixed with `cf.`.

| Marker | Payload | When |
|--------|---------|------|
| `cf.challenge_detected` | `{type}` | Challenge found |
| `cf.presence_start` | `{type?: 'invisible'}` | Begin presence simulation |
| `cf.page_traversal` | `{skipped_phase1, iframe_backend_node_id, iframe_frame_id}` | Phase 1 result (clean page WS DOM walk) |
| `cf.oopif_discovered` | `{method, via, targetId, url}` | OOPIF iframe found (`via: 'proxy_ws'` or `'direct_ws'`) |
| `cf.cdp_dom_session` | `{executionContextId}` | OOPIF attached + isolated world created |
| `cf.cdp_checkbox_found` | `{method, backendNodeId}` | Checkbox element located (`method: 'isolated_world' | 'runtime_query' | 'dom_tree_walk'`) |
| `cf.cdp_no_checkbox` | — | Checkbox not found after 8 polls |
| `cf.cdp_click_target` | `{x, y, width, height}` | Click coordinates calculated |
| `cf.waiting_for_wasm` | `{wait_ms}` | Delaying click until 2000ms minimum elapsed (WASM arming) |
| `cf.oopif_click` | `{ok, method, x, y}` | Click dispatched on OOPIF |
| `cf.click_to_nav` | `{click_to_nav_ms, type}` | Ms between click dispatch and page navigation |
| `cf.token_polled` | `{token_length}` | Token retrieved via `turnstile.getResponse()` polling (post-detection, safe) |
| `cf.auto_solved` | `{signal}` | Auto-solved; signal = where caught |
| `cf.state_change` | `{state}` | Iframe state transition |
| `cf.solved` | `{type, method, duration_ms}` | Final solve (`method: 'click_navigation' | 'auto_navigation' | 'auto_solve' | 'state_change'`) |
| `cf.failed` | `{reason, duration_ms}` | All attempts failed |
| `cf.iframe_session_refreshed` | — | OOPIF session ID refreshed after CDP reconnect |

---

## Auto-Solve Detection

Auto-solve (CF passes without a click) is detected **post-navigation**, never pre-click:

1. **Navigation auto-solve:** Page navigates away from CF URL → `onPageNavigated` confirms destination is non-CF → emits `cf.solved` with method `auto_navigation`
2. **Binding auto-solve:** `onAutoSolveBinding` fires when the Turnstile callback hook triggers
3. **Background loop:** For `non_interactive`/`invisible` types only, polls `isSolved()` every 3-7s. Safe because these aren't click-based challenges.

**`isSolved()` is post-solve only for click-based types.** The pre-click flow does NOT call it — that was the old bug.

---

## Configuration

```typescript
interface SolverConfig {
  maxAttempts?: number;        // Default: 3
  attemptTimeout?: number;     // Default: 30000ms
  recordingMarkers?: boolean;  // Default: true
}
```

Passed via `Browserless.enableChallengeSolver` CDP command from client.

## Lifecycle

1. Solver created **disabled** by `replay-session.ts` (one per ReplaySession)
2. Client sends `Browserless.enableChallengeSolver` → `detector.enable()` activates and scans existing pages
3. CDP events from `replay-session` flow into `onPageAttached/Navigated`, `onIframeAttached/Navigated` (via delegator)
4. Detector detects → strategies solve → state tracker tracks → emitter emits `Browserless.challenge*` events
5. `destroy()` cascades to all 4 sub-components — sets `destroyed` flag, clears all maps

## Abort Flag Contract

`active.aborted = true` is set in ALL terminal paths to stop the activity loop:

| Path | Where |
|------|-------|
| `onTurnstileStateChange('success')` | After verification, before delete |
| `onTurnstileStateChange('fail'/'expired'/'timeout')` | Before retry or final failure |
| `resolveAutoSolved()` | Before delete |
| `onPageNavigated()` | When page navigates away |

On retry, `aborted` is reset to `false` before calling `solveChallenge()` again.

---

## Investigation History

### The Journey to Zero-Injection (2026-02-20 → 2026-02-23)

#### Phase 1: CDP mouse events on parent page (failed)

CDP `Input.dispatchMouseEvent` on the parent page session. Chrome's compositor routes the click into the OOPIF, and the click registers (CF state changes to "clicked"). But CF rechallenges every time.

**Root cause discovered later:** `screenX`/`screenY` mismatch — Chrome bug [#40280325](https://issues.chromium.org/issues/40280325) sets `screenX = clientX` instead of `window.screenX + clientX`. Added JS override via Chrome extension (`extensions/screenxy-patch/patch.js` with `all_frames: true, world: "MAIN"`).

#### Phase 2: Comprehensive CDP event patching (failed)

Patched every known CDP detection vector:
- `screenX/screenY` — injected into OOPIFs via CDP
- `UIEvent.sourceCapabilities` — returns `InputDeviceCapabilities({firesTouchEvents: false})`
- `PointerEvent.pressure` — returns `0.5` when `buttons > 0`
- `PointerEvent.width/height` — returns `1` (real mouse 1x1)

All patches confirmed working via OOPIF probe. Event spy showed correct properties. **CF still rechallenged.** The detection was not at the event property level.

#### Phase 3: xdotool XTEST events (click worked, V8 poisoned)

Switched to `xdotool` with `XTestFakeButtonEvent` on Xvfb for `isTrusted: true` clicks. Click delivery worked perfectly — verified with standalone Chrome test. Multi-instance targeting via `xdotool search --pid`, `windowraise`, `windowfocus`, `Page.bringToFront`.

**But CF's WASM still rejected** — not due to click delivery, but due to **pre-click JS injection** on the page. `Runtime.evaluate(CF_DETECTION_JS)` was called to classify the challenge type before clicking.

#### Phase 4: CDP disconnect/reconnect (partial success)

Implemented `disconnectForChallenge()` / `reconnectAfterChallenge()` — close all WS connections during xdotool click so Chrome has zero CDP clients. After reconnect, all session IDs are stale (Chrome assigns new ones per connection). Added polling loop to wait for `active.iframeCdpSessionId` to refresh.

Improved solve rate but wasn't 100% — the detection JS had already run before disconnect.

#### Phase 5: Zero-injection copying pydoll's approach (THE FIX, 2026-02-23)

Root cause identified: `Runtime.evaluate(CF_DETECTION_JS)` on the page before clicking. CF's WASM observes V8 evaluation in the page context and flags the session.

**Fix:** Replace all pre-click `Runtime.evaluate` with pydoll's approach:
- **Detection:** URL pattern matching (zero CDP) + `DOM.getDocument` walk (C++ layer, bypasses V8)
- **Click target:** Isolated WS → active OOPIF discovery via `Target.getTargets` → `Target.attachToTarget` → `Runtime.callFunctionOn` on OOPIF (separate V8 isolate) → shadow root walk → `span.cb-i` checkbox
- **Pre-click `isSolved()` removed** entirely for click-based types

Result: 3/3 on nopecha, 3-5s solve time, 100% Ahrefs production solve rate.

#### What was tried and why it failed

| Approach | Why It Failed |
|----------|---------------|
| CDP mouse events on parent page | Chrome `screenX`/`screenY` bug |
| `screenX`/`screenY` JS override via extension | CF detected `addScriptToEvaluateOnNewDocument` |
| Comprehensive CDP event patching (screenX, sourceCapabilities, pressure, width/height) | All properties correct, CF detects at a different level |
| xdotool XTEST clicks | Click delivery fine, but pre-click `Runtime.evaluate` poisoned V8 |
| CDP disconnect during click | Detection JS already ran before disconnect |
| Fingerprint cleanup (`__navLangPatched`, binding renames, non-enumerable props) | Necessary but not sufficient — V8 evaluation was the root cause |
| Push-based beacons (`getCfPushDetectionScript()`, `sendBeacon` endpoints) | Eliminated CDP polling latency but still injected scripts on the page |

#### Phase 6: V8 Context Tainting Discovery (2026-02-23)

After Phase 5's zero-injection fix gave 100% solve rate, investigated **why** Phase 1 (page-side DOM traversal) was detected while pydoll's identical commands were not.

**Root cause:** Not `DOM.getDocument(pierce:true)` itself — that's C++ layer, always safe. Phase 1 also called `Runtime.callFunctionOn` on shadow root objects to walk the DOM tree. When sent through ReplaySession's internal WS, this command executed in a V8 context tainted by recording setup (`Page.addScriptToEvaluateOnNewDocument` for rrweb, `Runtime.addBinding` for `__csrfp`/`__perf`). CF's WASM detected the accumulated state.

Pydoll does the **exact same Phase 1 commands** but through a fresh `/devtools/page/{targetId}` WS — CDPProxy's opaque byte tunnel with zero accumulated V8 state. Clean context, no detection.

**Changes made:**

| Change | Before | After |
|--------|--------|-------|
| OOPIF command routing | `createIsolatedConnection()` (fresh raw WS per attempt) | `sendViaProxy` (CDPProxy browser WS — clean, reusable) |
| Phase 1 (page DOM walk) | Attempted through ReplaySession's tainted WS | **RE-ENABLED** via fresh `/devtools/page/` WS (marker: `cf.page_traversal {skipped_phase1: false}`) |
| Turnstile detection | `DOM.getDocument(pierce:true)` on page → tree walk | `Target.getTargets` (browser-level, zero page V8) |
| OOPIF discovery filter | URL-only filter | frameId match + `parentFrameId` fallback (matches pydoll) |
| Frame validation | Skipped | `Page.getFrameTree(sessionId)` (matches pydoll) |
| Isolated world | Not done | `Page.createIsolatedWorld(frameId)` (matches pydoll) |
| Checkbox finding | Single attempt | 8 polls × 500ms, 3 methods: `isolated_world` → `runtime_query` → `dom_tree_walk` |
| Pre-click wait | None | 2000ms minimum elapsed (WASM arming delay) |
| Click attribution | Not tracked | `clickDelivered` flag → `click_navigation` vs `auto_navigation` in `cf.solved` |
| Click timing | Not tracked | `cf.click_to_nav` marker (ms between click and navigation) |

**Key insight:** The WS connection is a hidden state vector. A "clean" command (`Runtime.callFunctionOn`) can trigger detection if sent through a "dirty" WS that has accumulated V8 state from earlier recording injections. The fix isn't always to change what you do — sometimes it's to change **where** you do it.

#### Phase 7: Detection Polling Regression (2026-02-24)

Attempted to upgrade `detectTurnstileViaCDP` from `Target.getTargets` to a clean-page-WS approach for richer type information. Binary search through changes proved:

| Detection Method | Result (5 nopecha runs) |
|-----------------|------------------------|
| `Target.getTargets` (committed) | **5/5 PASS** — all click_navigation, 3s |
| Clean WS + `DOM.getDocument` + `Runtime.evaluate` | **Rechallenge on run 2** |
| Clean WS + `DOM.getDocument` only (no evaluate) | **Timeout** — 19 events, never solved in 30s |
| `Target.getTargets` (reverted) | **5/5 PASS** — confirmed fix |

The detection polling loop runs `detectTurnstileViaCDP` up to 20 times at 200ms intervals. Even on a fresh `/devtools/page/` WS with zero V8 state, this frequency of page-level interaction is visible to CF:
- `Runtime.evaluate` → V8 evaluation events detected by WASM → rechallenge
- `DOM.getDocument` alone → Chrome's C++ DOM layer, but repeated 20× during challenge → CF times out the widget

**Key refinement:** `DOM.getDocument` is safe as a **single call** (Phase 1 clicking) but **unsafe in a polling loop** (detection). The frequency matters, not just the command.

Also added `turnstile.getResponse()` token polling to `solveTurnstile` — after click attempts, polls for token to handle non-interactive widgets that auto-solve without clicking (Ahrefs). `Runtime.evaluate` is safe post-detection because CF's checks run during detection, not during post-click polling.

#### The key insight

All fingerprint cleanup (SecurityError fixes, binding renames, non-enumerable properties, Symbol-keyed storage) was **necessary but not sufficient**. The root cause was always `Runtime.evaluate` on the page session. Once eliminated, clicks passed on first attempt without needing any of the other mitigations.

The Phase 6 discovery refines this: it's not just `Runtime.evaluate` — it's **any V8-touching command sent through a WS that has accumulated state from recording setup**. The WS connection itself becomes a detection vector.

The Phase 7 discovery adds a frequency dimension: even safe C++ commands (`DOM.getDocument`) become dangerous when called repeatedly in a polling loop during the challenge window. Detection must use browser-level commands (`Target.getTargets`) exclusively.
