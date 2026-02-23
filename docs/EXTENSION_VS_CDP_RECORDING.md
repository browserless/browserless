# Extension vs CDP Recording: Architecture Decision Record

Why browserless migrated rrweb recording from pure CDP injection to a Chrome extension.

## Table of Contents

1. [The Problem](#1-the-problem)
2. [CDP Recording: How It Worked](#2-cdp-recording-how-it-worked)
3. [CDP Recording: Where It Broke](#3-cdp-recording-where-it-broke)
4. [Extension Recording: How It Works](#4-extension-recording-how-it-works)
5. [Extension Recording: Why It's Better](#5-extension-recording-why-its-better)
6. [What CDP Is Still Used For](#6-what-cdp-is-still-used-for)
7. [Performance Comparison](#7-performance-comparison)

---

## 1. The Problem

Browserless records every scraping session using [rrweb](https://github.com/rrweb-io/rrweb) — a DOM mutation observer that captures page state as replayable events. These recordings are the diagnostic backbone: when a scrape fails, the replay shows exactly what happened on-screen, click-by-click.

For the first several months, rrweb injection and event collection were done entirely through CDP (Chrome DevTools Protocol). This worked "mostly" — recordings existed, replays played back — but under production concurrency (5–15 concurrent tabs), failure modes accumulated:

- **Empty replays**: 0-event recordings despite successful scrapes (see [WEBSOCKET_ARCHITECTURE.md §6](WEBSOCKET_ARCHITECTURE.md#6-the-0-event-replay-bug-collectevents-via-per-page-ws))
- **Missed early DOM**: rrweb starting after `attachShadow` calls, missing Cloudflare Turnstile's closed shadow roots
- **Stuck sessions**: Per-page WebSocket connections dying silently, blocking all event collection (see [WEBSOCKET_ARCHITECTURE.md §5](WEBSOCKET_ARCHITECTURE.md#5-the-stuck-session-issue))
- **Event loss during intervals**: Polling-based collection losing events when connections dropped between read and clear

The extension migration was not a rewrite for elegance — it was a response to production bugs that couldn't be fixed within the CDP injection model.

---

## 2. CDP Recording: How It Worked

The CDP-based recording lifecycle had three phases: injection, collection, and finalization.

### Injection

When a new page target attached (`Target.attachedToTarget`), the server:

1. **Paused the target** via `Target.setAutoAttach({ waitForDebuggerOnStart: true, flatten: true })` — this stopped the page before any JS executed
2. **Registered rrweb** via `Page.addScriptToEvaluateOnNewDocument({ source: rrwebBundle, runImmediately: true })` — scheduled rrweb to run on every navigation
3. **Injected immediately** via `Runtime.evaluate` — for the current page that was already paused
4. **Resumed** via `Runtime.runIfWaitingForDebugger` — let the page continue with rrweb installed

For cross-origin iframes (e.g., Cloudflare Turnstile at `challenges.cloudflare.com`), each iframe was a separate CDP target requiring its own `attachedToTarget` handler, separate `Runtime.evaluate` injection, and separate `Runtime.runIfWaitingForDebugger` resume.

### Collection

Events accumulated in an in-page JavaScript array (`window.__browserlessRecording.events`). The server collected them via periodic polling:

```
Every 500ms per tab:
  Runtime.evaluate → "window.__browserlessRecording.events.splice(0)"
  → Parse JSON response → sessionReplay.addTabEvents()
```

With 5 concurrent tabs, this was 10 `Runtime.evaluate` commands per second just for event collection — separate from pydoll's own CDP commands (navigation, DOM queries, form fills) and the CF solver's polling.

### Per-page WebSockets

To reduce contention on the single browser-level WebSocket, the server opened dedicated per-page WebSocket connections (`ws://127.0.0.1:{port}/devtools/page/{targetId}`) and routed `Runtime.evaluate` calls through them. This eliminated contention between tabs but added complexity: keepalive management, reconnection logic, and a new class of bugs when these connections died.

```
pydoll → CDPProxy WS (browser-level)  → Chrome
browserless → Replay WS (browser-level) → Chrome
browserless → Per-page WS ×5 (per tab)  → Chrome page isolates
```

Total: 7 WebSocket connections per session. See [WEBSOCKET_ARCHITECTURE.md §1](WEBSOCKET_ARCHITECTURE.md#1-connection-topology).

### Finalization

When a tab was destroyed or the session ended:
1. Final `Runtime.evaluate` to drain remaining events
2. `sessionReplay.stopTabReplay()` to flush to storage
3. Close per-page WebSocket, clean up target state

---

## 3. CDP Recording: Where It Broke

### 3.1 Race Conditions with Page Lifecycle

Even with `waitForDebuggerOnStart`, the injection sequence was a **race between CDP commands and Chrome's page lifecycle**:

```
Target paused
  → Send addScriptToEvaluateOnNewDocument (async, network latency)
  → Send Runtime.evaluate with rrweb bundle (async, network latency)
  → Send runIfWaitingForDebugger (async)
Page resumes → page JS begins
```

If Chrome processed `runIfWaitingForDebugger` before `addScriptToEvaluateOnNewDocument` completed (possible under load when the browser-level WS had queued commands), page JavaScript could execute before rrweb was installed. This meant:

- `attachShadow({ mode: 'closed' })` calls during element construction were missed — rrweb's `patchAttachShadow` interceptor wasn't in place yet. Cloudflare Turnstile's entire shadow DOM tree became invisible in recordings. See [TURNSTILE_RECORDING.md](TURNSTILE_RECORDING.md).
- Early DOM mutations (before rrweb's `MutationObserver` started) produced incomplete initial snapshots
- Font loads triggered before rrweb's `collectFonts` hook was installed were missed

The CDP approach gave "usually before page JS" timing. The extension gives "guaranteed before page JS" timing.

### 3.2 OOPIF Complexity

Cross-origin iframes (OOPIFs) were separate processes in Chrome, each requiring:

- Listening for `Target.attachedToTarget` with `targetInfo.type === 'iframe'`
- Opening a new CDP session to that iframe target
- Injecting a **lightweight** rrweb variant (no console plugin, no network capture — those conflict with cross-origin page JS)
- Coordinating PostMessage between child rrweb and parent rrweb instances
- Resuming the iframe's debugger

Each iframe added 3–5 CDP commands to the injection sequence. With Turnstile rendering inside a cross-origin iframe, every CF-protected page doubled the CDP command count for injection alone.

### 3.3 WebSocket Contention

The per-page WebSocket solution (see [WEBSOCKET_ARCHITECTURE.md §2](WEBSOCKET_ARCHITECTURE.md#2-why-per-page-websockets-exist)) traded one problem for three:

| Problem | Description | Impact |
|---------|-------------|--------|
| **Silent death** | Per-page WS connections died without TCP errors under Chrome memory pressure or GC pauses | All `Runtime.evaluate` commands timed out at 30s — entire session stuck |
| **Atomic read-and-clear loss** | `events.splice(0)` cleared the buffer in Chrome, but the response was lost when the WS died | Events permanently destroyed — not in buffer (cleared), not collected (response lost) |
| **Keepalive complexity** | 30s ping/pong cycle per WS, fallback routing, reconnection logic | 100+ lines of infrastructure code for a polling mechanism |

The stuck session issue ([WEBSOCKET_ARCHITECTURE.md §5](WEBSOCKET_ARCHITECTURE.md#5-the-stuck-session-issue)) was particularly damaging: after ~10 minutes of successful operation, every tab's per-page WS would die simultaneously (Chrome GC pressure), and the entire session became unresponsive.

The 0-event replay bug ([WEBSOCKET_ARCHITECTURE.md §6](WEBSOCKET_ARCHITECTURE.md#6-the-0-event-replay-bug-collectevents-via-per-page-ws)) was the most insidious: successful scrapes with zero events in the replay file. The `catch {}` in `collectEvents` swallowed the WS error, and the events were gone — cleared from the page buffer but never delivered to the server.

### 3.4 Polling Overhead

At 500ms intervals across 5 tabs:

| Component | CDP Commands/sec | Purpose |
|-----------|-----------------|---------|
| Event collection | 10 | `Runtime.evaluate` (5 tabs × 2/sec) |
| CF solver polling | 2–10 | `Runtime.evaluate` for Turnstile detection |
| pydoll commands | Variable | Navigation, DOM queries, form fills |
| **Total** | **12–20+** | All competing on shared WebSocket |

Under concurrency (15 tabs), this scaled to 30+ `Runtime.evaluate` commands per second for event collection alone. Each command took ~8s under contention (see [CLOUDFLARE_SOLVER.md](CLOUDFLARE_SOLVER.md)), making the polling model fundamentally unscalable.

### 3.5 Self-Healing Complexity

Because CDP injection could fail in numerous ways, the codebase accumulated defensive mechanisms:

- Zero-event detection timers that re-injected rrweb if no events arrived within 5s
- `Runtime.evaluate` fallback injection on `Target.targetInfoChanged` navigation events
- `forceMainWs` parameter to bypass per-page WS for critical operations
- Multiple code paths for "the page might not have rrweb yet"
- Double-execution guards in injected scripts (`if (window.__browserlessRecording) return`)

Each self-healing mechanism was a band-aid on a fundamentally fragile injection model.

### 3.6 Fetch Interception Conflict

Chrome has a known limitation: `Page.addScriptToEvaluateOnNewDocument` **does not fire** on pages loaded via CDP `Fetch.fulfillRequest` (Fetch domain interception). While browserless doesn't currently use Fetch interception, this limitation meant that any future integration with tools that do intercept at the Fetch level would silently break recording.

---

## 4. Extension Recording: How It Works

### Manifest Configuration

The extension uses Manifest v3 content scripts:

```json
{
  "manifest_version": 3,
  "name": "Browserless Recorder",
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["rrweb-recorder.js"],
    "run_at": "document_start",
    "world": "MAIN",
    "all_frames": true
  }]
}
```

Key properties:
- **`run_at: "document_start"`**: Executes before any page JavaScript, including the `<head>` scripts
- **`world: "MAIN"`**: Runs in the page's JavaScript context (not an isolated extension world), so rrweb can observe the real DOM
- **`all_frames: true`**: Automatically injects into every frame, including cross-origin iframes

### Recording Flow

**Source:** `extensions/replay/src/recorder.ts` (91 lines)

```
Chrome creates page
  → Extension content script runs at document_start (before ANY page JS)
  → Script initializes:
       - Iframe? → Minimal rrweb (PostMessage events to parent)
       - Main frame? → Full rrweb recording with:
           - Console plugin (error, warn, info, log, debug)
           - recordCrossOriginIframes: true
           - Canvas recording, font collection
           - Push delivery via __rrwebPush binding (if available)
           - Array buffer fallback (if binding not yet registered)
```

### Event Delivery

Events flow through two paths:

**Primary — Push via `Runtime.addBinding`:**
```
rrweb emits event
  → recorder.ts emit() callback
  → Buffer in rec._buf[] (500ms microbatch)
  → setTimeout fires → window.__rrwebPush(JSON.stringify(batch))
  → Chrome fires Runtime.bindingCalled CDP event
  → replay-session.ts handleBindingCalled() receives events
  → sessionReplay.addTabEvents() stores them
```

**Fallback — Array buffer:**
```
rrweb emits event (before __rrwebPush is registered)
  → recorder.ts emit() callback
  → rec.events.push(event) (in-page array)
  → replay-session.ts collectEvents() drains during finalization
```

The push path has **zero CDP commands** for steady-state event delivery. The fallback only catches the brief window between page load and `Runtime.addBinding` registration.

### Network Capture

**Source:** `extensions/replay/src/network-capture.ts` (267 lines)

The extension patches `window.fetch` and `XMLHttpRequest.prototype` to capture HTTP traffic as rrweb custom events (type 5):

- Request URL, method, headers, truncated body (10KB max)
- Response status, headers, truncated body
- Error/abort events with durations

This runs in the `MAIN` world alongside page JavaScript — no CDP `Network.enable` needed for the main frame. Network events are delivered through the same push/array paths as DOM events.

### Iframe Handling

rrweb's built-in `recordCrossOriginIframes` feature handles iframe recording:

1. **Parent frame** listens for `PostMessage` events with `{type: "rrweb"}`
2. **Child frame** (injected via `all_frames: true`) auto-detects cross-origin context and sends events via `window.parent.postMessage()`
3. Parent rrweb transforms child events into the parent recording timeline

No CDP iframe sessions needed for recording. The extension's `all_frames: true` replaces the entire `targetInfo.type === 'iframe'` injection path.

---

## 5. Extension Recording: Why It's Better

### 5.1 Guaranteed Execution Order

Chrome extensions with `run_at: "document_start"` execute before **any** page JavaScript — not "usually before" like `Page.addScriptToEvaluateOnNewDocument` + `Runtime.runIfWaitingForDebugger`. This is a Chrome-enforced guarantee, not a race condition we hope to win.

This means:
- `patchAttachShadow` is installed before Turnstile's closed shadow DOM construction
- `MutationObserver` captures the full initial DOM, not a post-load snapshot
- Font load hooks are in place before CSS triggers font fetches

### 5.2 Zero CDP Overhead for Recording

| Operation | CDP Approach | Extension Approach |
|-----------|-------------|-------------------|
| rrweb injection (per page) | 3 commands (`addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` + `runIfWaitingForDebugger`) | 0 commands (content script) |
| rrweb injection (per iframe) | 3–5 commands per iframe | 0 commands (`all_frames: true`) |
| Event collection (steady-state) | 10 `Runtime.evaluate`/sec (5 tabs × 2/sec) | 0 commands (push via `Runtime.addBinding`) |
| Event collection (finalization) | 1 `Runtime.evaluate` per tab | 1 `Runtime.evaluate` per tab (drain stragglers) |
| Network capture | `Network.enable` per target + parse CDP events | 0 commands (JS-level fetch/XHR interception) |

The extension eliminates **all steady-state CDP commands** for recording. The only CDP interaction is the one-time `Runtime.addBinding('__rrwebPush')` registration per page target.

### 5.3 Native Iframe Handling

| Aspect | CDP Approach | Extension Approach |
|--------|-------------|-------------------|
| Injection | Per-iframe CDP session + `Runtime.evaluate` | `all_frames: true` in manifest |
| Event delivery | PostMessage (required CDP injection first) | PostMessage (rrweb built-in) |
| Console capture | `Runtime.enable` per iframe CDP session | rrweb console plugin in parent |
| Failure mode | Injection fails → iframe invisible in replay | Extension always injects → iframe always visible |

The extension's `all_frames: true` means Chrome itself handles iframe injection — the same mechanism that powers ad blockers and password managers. No CDP sessions, no timing windows, no partial failures.

### 5.4 Network Capture Without CDP

CDP-based network capture requires `Network.enable` per target and produces verbose events that must be parsed server-side. The extension intercepts at the JavaScript level:

```typescript
// Extension patches window.fetch in MAIN world
const originalFetch = window.fetch;
window.fetch = function(input, init) {
  emitNetworkEvent('network.request', { url, method, headers, body });
  return originalFetch.apply(this, arguments).then(response => {
    emitNetworkEvent('network.response', { url, status, headers, body });
    return response;
  });
};
```

This captures request/response bodies (truncated to 10KB), which the CDP Network domain only exposes via additional `Network.getResponseBody` calls. The extension captures them inline at zero CDP cost.

### 5.5 Simpler Codebase

| Component | CDP Approach | Extension Approach |
|-----------|-------------|-------------------|
| Recording script | Inline JS strings in server code | `recorder.ts` (91 lines) |
| Network capture | Server-side CDP event parsing | `network-capture.ts` (267 lines) |
| Manifest | N/A | `manifest.json` (16 lines) |
| **Extension total** | N/A | **~375 lines** |
| Server-side orchestration | 1000+ lines (injection, polling, per-page WS, self-healing) | ~980 lines (lifecycle, push routing, CF solver, screencast) |

The server-side code is comparable in line count, but the concerns shifted: CDP recording required the server to handle injection, polling, per-page WS management, and self-healing. Extension recording lets the server focus on lifecycle management, push delivery routing, and CF solver coordination.

More importantly, the eliminated code paths were the ones that produced bugs: per-page WS keepalive, atomic read-and-clear, re-injection timers, and multi-path injection fallbacks.

### 5.6 Push Delivery Preserved

The extension integrates with the same `Runtime.addBinding('__rrwebPush')` mechanism used for real-time event streaming. Events are microbatched (500ms) and pushed through the binding:

```typescript
// In recorder.ts emit() callback
if (window.__rrwebPush) {
  buf.push(event);
  if (!rec._ft) {
    rec._ft = setTimeout(() => {
      window.__rrwebPush!(JSON.stringify(buf));
    }, 500);
  }
} else {
  rec.events.push(event);  // Array fallback
}
```

If the binding isn't registered yet (brief window at page start), events accumulate in the array buffer and are drained during finalization. This is the same pattern as the CF solver's push-based detection — see [CLOUDFLARE_SOLVER.md](CLOUDFLARE_SOLVER.md).

---

## 6. What CDP Is Still Used For

The extension handles rrweb injection and event collection. CDP is still essential for everything else:

| CDP Usage | Domain/Method | Why Extension Can't Do This |
|-----------|--------------|---------------------------|
| Push delivery registration | `Runtime.addBinding('__rrwebPush')` | Bindings are a CDP-only mechanism |
| Session ID injection | `Runtime.evaluate` (set `__browserlessRecording.sessionId`) | Server-assigned ID, not known at extension load |
| Iframe auto-attach | `Target.setAutoAttach({ waitForDebuggerOnStart: true })` | Extension injects rrweb, but CF solver needs CDP sessions for Turnstile iframes |
| CF solver mouse events | `Input.dispatchMouseEvent` | Physical input simulation requires CDP |
| CF solver detection/solve beacons | HTTP `sendBeacon()` to localhost | Actually runs in-page JS (no CDP), but solver orchestration is server-side |
| Screencast/video | `Page.startScreencast` | Only accessible via CDP |
| Tab lifecycle | `Target.setDiscoverTargets`, `Target.attachToTarget` | Extension can't observe tab creation/destruction server-side |
| Turnstile state tracking | `Runtime.addBinding('__turnstileStateBinding')` + observer injection | CF-specific CDP integration |
| Diagnostic probes | `Runtime.evaluate` (rrweb state check 2s after attach) | Debug-only, could be removed |
| Finalization drain | `Runtime.evaluate` (flush push buffer + drain array) | One-shot at tab/session end |

The split is clean: **the extension owns recording** (rrweb injection, event capture, network capture). **CDP owns orchestration** (lifecycle, CF solver, screencast, push binding registration).

---

## 7. Performance Comparison

### CDP Commands Per Scrape (5 tabs, CF-protected site)

| Phase | CDP Approach | Extension Approach |
|-------|-------------|-------------------|
| **Injection (per page)** | 3 commands × 5 tabs = 15 | 1 command × 5 tabs = 5 (`Runtime.addBinding` only) |
| **Injection (per iframe)** | 4 commands × 5 iframes = 20 | 0 commands |
| **Event collection (60s scrape)** | 120 × 5 tabs = 600 | 0 commands |
| **CF solver polling** | ~25 commands/solve × 5 tabs = 125 | ~1 command/solve × 5 tabs = 5 |
| **Finalization** | 5 commands | 5 commands (flush + drain) |
| **Network capture setup** | 5 `Network.enable` commands | 0 commands |
| **Total** | **~770** | **~15** |

### Event Delivery Latency

| Metric | CDP Polling (500ms) | Extension Push (500ms microbatch) |
|--------|-------------------|----------------------------------|
| Best-case latency | 0ms (polled right after emit) | 0–500ms (next batch flush) |
| Worst-case latency | 500ms (emitted right after poll) | 500ms (just missed batch) |
| Average latency | ~250ms | ~250ms |
| **Under contention (15 tabs)** | **~8s** (WS command queue) | **~250ms** (unchanged — no WS commands) |

The key difference is under contention: CDP polling latency scales with tab count because every `Runtime.evaluate` competes on a shared WebSocket. Push delivery is independent of tab count — events arrive as CDP events on the browser WS without queueing behind other commands.

### Failure Modes Under Concurrency

| Failure | CDP Approach | Extension Approach |
|---------|-------------|-------------------|
| Per-page WS death | Events permanently lost (atomic read-and-clear) | N/A — no per-page WS for recording |
| Chrome GC pressure | All per-page WS die → session stuck | Push events arrive on browser WS — unaffected |
| `addScriptToEvaluateOnNewDocument` race | rrweb misses early DOM mutations | N/A — `document_start` guarantees order |
| Tab count scaling | Linear CDP command increase | Constant — zero CDP commands for recording |
| Fetch interception pages | `addScriptToEvaluateOnNewDocument` doesn't fire | Extension content scripts always fire |

---

## References

| Document | Content |
|----------|---------|
| [WEBSOCKET_ARCHITECTURE.md](WEBSOCKET_ARCHITECTURE.md) | Per-page WS topology, stuck sessions (§5), 0-event replay bug (§6) |
| [CLOUDFLARE_SOLVER.md](CLOUDFLARE_SOLVER.md) | CDP polling → push migration precedent, performance numbers |
| [TURNSTILE_RECORDING.md](TURNSTILE_RECORDING.md) | Closed shadow DOM, cross-origin iframe handling |

| Source File | Content |
|-------------|---------|
| `extensions/replay/src/recorder.ts` | Extension rrweb recorder (91 lines) |
| `extensions/replay/src/network-capture.ts` | Extension network capture (267 lines) |
| `extensions/replay/manifest.json` | Content script configuration |
| `src/session/replay-session.ts` | Server-side lifecycle orchestration (extension-aware) |
| `src/session/replay-coordinator.ts` | Session-level coordinator (manages ReplaySession instances) |
