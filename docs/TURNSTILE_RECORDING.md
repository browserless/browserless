# Turnstile Recording

Cloudflare Turnstile uses two techniques that make recording difficult: closed shadow DOM and cross-origin iframes. Both are now handled.

## Solved: Closed Shadow DOM

Turnstile uses `attachShadow({ mode: 'closed' })`, which normally makes `element.shadowRoot` return `null`.

The `@divmode/rrweb` fork (v0.0.38) patches `attachShadow` to intercept closed roots. This **requires rrweb to be injected before `attachShadow` is called**.

### Fix: `Target.setAutoAttach` with `waitForDebuggerOnStart`

`recording-coordinator.ts` uses `Target.setAutoAttach({ waitForDebuggerOnStart: true, flatten: true })` to pause new page targets before any JS executes. While paused, rrweb is injected via `Page.addScriptToEvaluateOnNewDocument`, then the target is resumed with `Runtime.runIfWaitingForDebugger`. This guarantees `patchAttachShadow` is installed before any page code runs — on every target, including the first navigation.

`flatten: true` creates dedicated CDP sessions per target, delivering `attachedToTarget` as top-level WebSocket messages with a `sessionId` for direct command routing.

**Previously (before fix):** `Target.setDiscoverTargets` + `Runtime.evaluate` injected rrweb after page JS had already run, missing any `attachShadow({ mode: 'closed' })` calls made during element construction.

**Tested 2026-01-29** with `static/test-shadow-dom.html` (before fix):

| Shadow DOM Mode | Captured? | Details |
|----------------|-----------|---------|
| Regular DOM | Yes | Baseline — always captured |
| Open (`mode: 'open'`) | Yes | Content + styles serialized with `isShadow` markers |
| Closed (`mode: 'closed'`) | **No** (before fix) | Custom element tag present, shadow root contents empty |

With the `setAutoAttach` fix, the closed shadow DOM row should now capture content since rrweb's interceptor is in place before `connectedCallback` runs.

Upstream rrweb ([PR #834](https://github.com/rrweb-io/rrweb/pull/834)) checks `if (this.shadowRoot)` which fails for closed roots. The `@divmode/rrweb` fork (v0.0.38) fixes this with two pieces:

**Interceptor** (`rrweb.js:13813-13833`) — uses the `attachShadow()` return value, not `this.shadowRoot`:

```javascript
patchAttachShadow(element, doc) {
  patch(element.prototype, "attachShadow", function(original) {
    return function(option) {
      const sRoot = original.call(this, option);   // return value works for both open + closed
      if (option.mode === "closed") {
        this.__rrClosedShadowRoot = sRoot;          // cache for later access
      }
      if (sRoot && inDom(this)) {
        manager.addShadowRoot(sRoot, doc);          // passes sRoot directly, not this.shadowRoot
      }
      return sRoot;
    };
  });
}
```

**Accessor** (`rrweb.js:138-144`) — reads the cached root first:

```javascript
function shadowRoot$1(n2) {
  if (!n2 || !("shadowRoot" in n2)) return null;
  if ("__rrClosedShadowRoot" in n2) {
    return n2.__rrClosedShadowRoot;                 // bypasses native .shadowRoot (null for closed)
  }
  return getUntaintedAccessor$1("Element", n2, "shadowRoot");
}
```

## Solved: Cross-Origin Iframe

Turnstile renders inside a cross-origin iframe (`challenges.cloudflare.com`). CDP has privileged access regardless of CORS, so we inject rrweb into iframe targets the same way we do for pages.

### Fix: Lightweight rrweb injection via CDP iframe targets

`recording-coordinator.ts` handles `targetInfo.type === 'iframe'` in the `attachedToTarget` handler. It injects a **lightweight** rrweb script (via `getIframeRecordingScript()`) that excludes main-frame features which conflict with cross-origin page JS:

- **No** `rrwebConsolePlugin` — console hooks can conflict with Cloudflare JS
- **No** `getNetworkCaptureScript()` — fetch/XHR hooks in cross-origin context would break
- **No** turnstile overlay — recursive detection inside Turnstile itself
- **No** event collection array — child rrweb sends events via PostMessage to parent

### How rrweb cross-origin works

1. **Parent frame** already has `recordCrossOriginIframes: true`, which registers each iframe's `contentWindow` in `crossOriginIframeMap` and listens for PostMessage events with `{type: "rrweb"}`
2. **Child rrweb** auto-detects cross-origin (try/catch on `window.parent.document`) and sends events via `window.parent.postMessage({type: "rrweb", event, origin}, "*")`
3. **Parent rrweb** transforms child events and merges them into the parent recording

The only missing piece was injecting rrweb into the iframe target via CDP — now handled by `getIframeRecordingScript()`.

### Design decisions

- **Not tracked for polling** — iframe targets are not added to `trackedTargets`/`injectedTargets` because PostMessage handles event delivery to the parent
- **Errors caught silently** — if a specific iframe crashes on injection (defensive), other iframes and the main page still work
- **Always resume** — even if injection fails, the iframe is resumed with `Runtime.runIfWaitingForDebugger` so the page isn't stuck

## Current State

The `getTurnstileOverlayScript()` function and all associated player CSS (`insertStyleRules`) have been **fully removed**. Turnstile now shows natively in recordings via rrweb's cross-origin iframe recording — no synthetic overlays or injected styles needed.

The player no longer injects white box styles for `.cf-turnstile` or `.g-recaptcha` containers. What you see in recordings is the real Cloudflare challenge page as captured by rrweb.

## References

- [rrweb PR #834 — attachShadow interception for nested shadow DOMs](https://github.com/rrweb-io/rrweb/pull/834)
- [rrweb issue #38 — shadow DOM / custom element recording](https://github.com/rrweb-io/rrweb/issues/38)
- [Sentry rrweb fork — shadow DOM build flags](https://github.com/getsentry/rrweb/pull/114)
