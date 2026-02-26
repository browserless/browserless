/**
 * Types and detection scripts for Cloudflare monitoring.
 * JS constants are injected into pages via CDP Runtime.evaluate.
 *
 * All types are defined as Effect Schemas, providing:
 * - Runtime validation via Schema.decodeSync / Schema.decodeExit
 * - Type inference via typeof X.Type (identical to the old interfaces)
 * - JSON Schema generation for the Python codegen pipeline
 */
import { Schema } from 'effect';

// ═══════════════════════════════════════════════════════════════════════
// CDP branded identifiers — compile-time-only, zero runtime overhead
// ═══════════════════════════════════════════════════════════════════════

export const CdpSessionId = Schema.String.pipe(Schema.brand("CdpSessionId"));
export type CdpSessionId = typeof CdpSessionId.Type;

export const TargetId = Schema.String.pipe(Schema.brand("TargetId"));
export type TargetId = typeof TargetId.Type;

// ═══════════════════════════════════════════════════════════════════════
// Reusable schema combinators
// ═══════════════════════════════════════════════════════════════════════

/** Finite integer (generates JSON Schema "type": "integer") */
const Int = Schema.Finite.pipe(Schema.check(Schema.isInt()));
/** Positive finite integer (> 0) */
const PositiveInt = Schema.Finite.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isGreaterThan(0)),
);

// ═══════════════════════════════════════════════════════════════════════
// Cloudflare Turnstile — Official Widget Modes
// https://developers.cloudflare.com/turnstile/concepts/widget/
// ═══════════════════════════════════════════════════════════════════════
//
// 1. MANAGED (recommended by CF)
//    Automatically chooses between showing a checkbox or auto-passing
//    based on visitor risk level. Only prompts interaction when CF
//    thinks it's necessary.
//
// 2. NON-INTERACTIVE
//    Displays a visible widget with a loading spinner. Runs challenges
//    in the browser without ever requiring the visitor to click anything.
//
// 3. INVISIBLE
//    Completely hidden. No widget, no spinner, no visual element.
//    Challenges run entirely in the background.
//
// ═══════════════════════════════════════════════════════════════════════
// Our Internal Types
// ═══════════════════════════════════════════════════════════════════════
//
// CloudflareType        │ Official Mode    │ Source                     │ Needs Click?
// ──────────────────────┼──────────────────┼────────────────────────────┼─────────────
// 'managed'             │ Managed          │ _cf_chl_opt.cType          │ Usually yes
// 'non_interactive'     │ Non-Interactive   │ _cf_chl_opt.cType          │ No (auto-solves)
// 'invisible'           │ Invisible         │ _cf_chl_opt.cType          │ No (auto-solves)
// 'interstitial'        │ (any — unknown)   │ Title/DOM/body heuristics  │ Yes (challenge page)
// 'turnstile'           │ (any — unknown)   │ Iframe/runtime poll        │ Try click, may auto-solve
// 'block'               │ N/A              │ CF error page DOM          │ Not solvable
//
// cType is available in most cases (CF interstitial pages always have _cf_chl_opt).
// 'turnstile' is the fallback for third-party pages where Turnstile is embedded
// but _cf_chl_opt is not exposed — we know a widget exists but not its mode.

export const CloudflareType = Schema.Literals([
  'managed',          // Official: Managed — may need click, may auto-pass
  'non_interactive',  // Official: Non-Interactive — auto-solves, spinner visible
  'invisible',        // Official: Invisible — auto-solves, nothing visible
  'interstitial',     // CF challenge page (mode unknown, no cType available)
  'turnstile',        // Turnstile iframe found but no cType (third-party embed, mode unknown)
  'block',            // CF error page — not solvable
]);
export type CloudflareType = typeof CloudflareType.Type;

export const CloudflareInfo = Schema.Struct({
  type: CloudflareType,
  url: Schema.String,
  iframeUrl: Schema.optionalKey(Schema.String),
  cType: Schema.optionalKey(Schema.String),
  cRay: Schema.optionalKey(Schema.String),
  detectionMethod: Schema.String,
  pollCount: Schema.optionalKey(Int),
});
export type CloudflareInfo = typeof CloudflareInfo.Type;

export const CloudflareConfig = Schema.Struct({
  maxAttempts: Schema.optionalKey(PositiveInt),
  attemptTimeout: Schema.optionalKey(PositiveInt),
  recordingMarkers: Schema.optionalKey(Schema.Boolean),
}).annotate({
  title: 'CloudflareConfig',
  description: 'Optional solver configuration sent via Browserless.enableCloudflareSolver CDP command',
});
export type CloudflareConfig = typeof CloudflareConfig.Type;

export const CloudflareResult = Schema.Struct({
  solved: Schema.Boolean,
  type: CloudflareType,
  method: Schema.String,
  token: Schema.optionalKey(Schema.String),
  token_length: Schema.optionalKey(Int),
  duration_ms: Schema.Finite,
  attempts: Int,
  auto_resolved: Schema.optionalKey(Schema.Boolean),
  signal: Schema.optionalKey(Schema.String),
  phase_label: Schema.optionalKey(Schema.String),
});
export type CloudflareResult = typeof CloudflareResult.Type;

export const CloudflareSnapshot = Schema.Struct({
  detection_method: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: 'How CF was detected: cf_chl_opt, title_interstitial, challenge_element, etc.',
  }),
  cf_cray: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: 'Cloudflare Ray ID from _cf_chl_opt.cRay',
  }),
  detection_poll_count: Schema.optionalKey(Int).annotate({
    description: 'Number of 500ms polls before challenge detected (1-20)',
    default: 0,
  }),
  widget_found: Schema.optionalKey(Schema.Boolean).annotate({
    description: 'Whether the CF solver found the Turnstile widget element',
    default: false,
  }),
  widget_find_method: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: 'Which method found the widget: iframe-src, shadow-root-div, etc.',
  }),
  widget_find_methods: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: 'All widget find methods tried across retries',
    default: [],
  }),
  widget_x: Schema.optionalKey(Schema.NullOr(Schema.Finite)).annotate({
    description: 'Click target X coordinate',
  }),
  widget_y: Schema.optionalKey(Schema.NullOr(Schema.Finite)).annotate({
    description: 'Click target Y coordinate',
  }),
  clicked: Schema.optionalKey(Schema.Boolean).annotate({
    description: 'Whether the CF solver\'s click caused the solve. False if CF auto-solved independently. See click_attempted for dispatch-level tracking.',
    default: false,
  }),
  click_attempted: Schema.optionalKey(Schema.Boolean).annotate({
    description: 'Whether the CF solver dispatched a click (regardless of outcome). Use for diagnostics. For attribution, use \'clicked\' which indicates the click caused the solve.',
    default: false,
  }),
  click_count: Schema.optionalKey(Int).annotate({
    description: 'Number of times the widget was clicked',
    default: 0,
  }),
  click_x: Schema.optionalKey(Schema.NullOr(Schema.Finite)).annotate({
    description: 'Actual click X coordinate (after mouse approach)',
  }),
  click_y: Schema.optionalKey(Schema.NullOr(Schema.Finite)).annotate({
    description: 'Actual click Y coordinate',
  }),
  presence_duration_ms: Schema.optionalKey(Int).annotate({
    description: 'Human presence simulation duration in ms',
    default: 0,
  }),
  presence_phases: Schema.optionalKey(Int).annotate({
    description: 'Number of presence phases (>1 if retried)',
    default: 0,
  }),
  approach_phases: Schema.optionalKey(Int).annotate({
    description: 'Number of approach phases (0 = auto-solved before approach)',
    default: 0,
  }),
  activity_poll_count: Schema.optionalKey(Int).annotate({
    description: 'Activity loop iterations (each 3-7s)',
    default: 0,
  }),
  false_positive_count: Schema.optionalKey(Int).annotate({
    description: 'False positive solve detections',
    default: 0,
  }),
  widget_error_count: Schema.optionalKey(Int).annotate({
    description: 'Widget error state detections',
    default: 0,
  }),
  iframe_states: Schema.optionalKey(Schema.Array(Schema.String)).annotate({
    description: 'Turnstile iframe state sequence: verifying, success, fail, etc.',
    default: [],
  }),
  widget_find_debug: Schema.optionalKey(
    Schema.NullOr(Schema.Record(Schema.String, Schema.Any))
  ).annotate({
    description: 'JSON debug info from click target search (iframes, ts_els, forms, shadow_hosts)',
  }),
  widget_error_type: Schema.optionalKey(Schema.NullOr(Schema.String)).annotate({
    description: 'Last error type: confirmed_error, error_text, iframe_error, expired',
  }),
}).annotate({
  title: 'CloudflareSnapshot',
  description: 'Accumulated state for one CF solve phase, included in solved/failed events.',
});
export type CloudflareSnapshot = typeof CloudflareSnapshot.Type;

/**
 * Fix navigator.languages + crossOriginIsolated to match a real Chrome browser.
 *
 * Two problems solved:
 * 1. Chrome with --lang=en-US sets navigator.languages to ["en-US"] but a real
 *    user's browser has ["en-US", "en"]. CF's fingerprint checks this value.
 * 2. crossOriginIsolated=true in some contexts when CF expects false.
 *
 * Critical: CF's fingerprint audit creates a hidden same-origin iframe and reads
 * iframe.contentWindow.navigator.languages SYNCHRONOUSLY. Each iframe gets its own
 * Navigator.prototype, so patching the parent's prototype doesn't help. And
 * addScriptToEvaluateOnNewDocument doesn't fire on synchronously-created iframes
 * (their initial about:blank document exists before any document load event).
 *
 * Solution: Intercept HTMLIFrameElement.prototype.contentWindow to auto-patch
 * the navigator in each new iframe context the moment it's first accessed.
 */
export const NAVIGATOR_LANGUAGES_PATCH_JS = `(function() {
  var langs = Object.freeze(['en-US', 'en']);

  // Guard: check if Navigator.prototype.languages already returns our frozen array.
  // This avoids re-patching without exposing any detectable property on window.
  try {
    var cur = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
    if (cur && cur.get && cur.get() === langs) return;
  } catch(e) {}

  // Closure-scoped tracking — invisible to any external code.
  // WeakSet allows GC of detached iframe windows.
  var patched = new WeakSet();

  function patchNavigator(nav, proto) {
    try { Object.defineProperty(proto, 'languages', {
      get: function() { return langs; },
      configurable: true, enumerable: true,
    }); } catch(e) {}
    try { Object.defineProperty(nav, 'languages', {
      get: function() { return langs; },
      configurable: true, enumerable: true,
    }); } catch(e) {}
    try { Object.defineProperty(proto, 'language', {
      get: function() { return 'en-US'; },
      configurable: true, enumerable: true,
    }); } catch(e) {}
  }

  function patchWindow(w) {
    if (!w || patched.has(w)) return;
    patched.add(w);
    try {
      var np = w.Navigator && w.Navigator.prototype;
      if (np) patchNavigator(w.navigator, np);
      // crossOriginIsolated is an own property per-window — must patch each instance
      Object.defineProperty(w, 'crossOriginIsolated', {
        get: function() { return false; },
        configurable: true, enumerable: true,
      });
    } catch(e) {} // cross-origin — ignore
  }

  // Patch current frame
  patchWindow(window);

  // Watch for new iframes via MutationObserver — less detectable than
  // overriding contentWindow getter. Patches same-origin iframes on insert.
  try {
    new MutationObserver(function(mutations) {
      for (var m = 0; m < mutations.length; m++) {
        var nodes = mutations[m].addedNodes;
        for (var n = 0; n < nodes.length; n++) {
          var node = nodes[n];
          if (node.tagName === 'IFRAME') {
            try { patchWindow(node.contentWindow); } catch(e) {}
          }
          // Also check children of added nodes
          if (node.querySelectorAll) {
            var iframes = node.querySelectorAll('iframe');
            for (var f = 0; f < iframes.length; f++) {
              try { patchWindow(iframes[f].contentWindow); } catch(e) {}
            }
          }
        }
      }
    }).observe(document.documentElement || document, {childList: true, subtree: true});
  } catch(e) {}
})()`;

/**
 * JS hook that wraps turnstile.render() to detect auto-solves.
 * Sets window.__turnstileSolved = true when callback fires.
 * Polls for late-arriving turnstile object (up to 30s).
 *
 * Source: pydoll-scraper/src/evasion/turnstile.py lines 76-133
 */
export const TURNSTILE_CALLBACK_HOOK_JS = `(function() {
    window.__turnstileSolved = false;
    window.__turnstileRenderParams = null;
    window.__turnstileRenderTime = null;
    window.__turnstileTokenLength = null;
    window.__turnstileWidgetId = null;

    function wrapRender(ts) {
        if (!ts || !ts.render || ts.__cbHooked) return;
        var orig = ts.render;
        ts.render = function(container, params) {
            params = params || {};
            window.__turnstileRenderTime = Date.now();
            window.__turnstileRenderParams = {
                sitekey: (params.sitekey || '').substring(0, 20),
                action: params.action || null,
                size: params.size || 'normal',
                appearance: params.appearance || null,
                theme: params.theme || 'auto'
            };

            if (typeof params.callback === 'function') {
                var origCb = params.callback;
                params.callback = function(token) {
                    window.__turnstileSolved = true;
                    window.__turnstileTokenLength = token ? token.length : 0;
                    if (typeof window.__turnstileSolvedBinding === 'function') {
                        try { window.__turnstileSolvedBinding('solved'); } catch(e) {}
                    }
                    return origCb.apply(this, arguments);
                };
            } else {
                params.callback = function(token) {
                    window.__turnstileSolved = true;
                    window.__turnstileTokenLength = token ? token.length : 0;
                    if (typeof window.__turnstileSolvedBinding === 'function') {
                        try { window.__turnstileSolvedBinding('solved'); } catch(e) {}
                    }
                };
            }

            var widgetId = orig.apply(this, arguments);
            window.__turnstileWidgetId = widgetId || null;
            return widgetId;
        };
        ts.__cbHooked = true;
    }

    if (window.turnstile) wrapRender(window.turnstile);
    var _pollId = setInterval(function() {
        if (window.turnstile && !window.turnstile.__cbHooked) {
            wrapRender(window.turnstile);
            clearInterval(_pollId);
        }
    }, 20);
    setTimeout(function() { clearInterval(_pollId); }, 30000);
})();`;

/**
 * JS detection script for Cloudflare-protected pages.
 * Checks _cf_chl_opt, #challenge-form (CF DOM element), title, body text.
 *
 * Source: pydoll-scraper/src/evasion/cloudflare.py lines 37-111
 */
export const CF_DETECTION_JS = `JSON.stringify((() => {
    if (typeof window._cf_chl_opt !== 'undefined') {
        return {
            detected: true,
            method: 'cf_chl_opt',
            cType: window._cf_chl_opt.cType || null,
            cRay: window._cf_chl_opt.cRay || null
        };
    }
    var challengeEl = document.querySelector('#challenge-form, #challenge-stage, #challenge-running');
    if (challengeEl) return { detected: true, method: 'challenge_element' };
    if (document.documentElement.classList.contains('challenge-running'))
        return { detected: true, method: 'challenge_running_class' };
    var title = (document.title || '').toLowerCase();
    if (title.includes('just a moment') || title.includes('momento') ||
        title.includes('un moment') || title.includes('einen moment'))
        return { detected: true, method: 'title_interstitial' };
    var bodyText = (document.body?.innerText || '').toLowerCase();
    if (bodyText.includes('verify you are human') ||
        bodyText.includes('checking your browser') ||
        bodyText.includes('needs to review the security'))
        return { detected: true, method: 'body_text_challenge' };
    if (document.querySelector('.cf-error-details, #cf-error-details'))
        return { detected: true, method: 'cf_error_page' };
    var html = document.documentElement.innerHTML || '';
    if (html.includes('challenges.cloudf'))
        return { detected: true, method: 'challenges_domain' };
    var cfForm = document.querySelector('form[action*="__cf_chl_f_tk"], form[action*="__cf_chl_jschl"]');
    if (cfForm) return { detected: true, method: 'cf_form_action' };
    var tsScript = document.querySelector('script[src*="/turnstile/"]');
    if (tsScript) return { detected: true, method: 'turnstile_script' };
    if (document.querySelector('#challenge-success-text'))
        return { detected: true, method: 'challenge_success' };
    var footer = (document.querySelector('footer') || {}).innerText || '';
    var footerLower = footer.toLowerCase();
    if (footerLower.includes('ray id') && footerLower.includes('cloudflare'))
        return { detected: true, method: 'ray_id_footer' };
    return { detected: false };
})())`;

/**
 * Map detection results to CloudflareType.
 *
 * CF_DETECTION_JS (lines 136-164) returns one of these detection methods:
 *
 *   DETECTION METHOD          │ WHAT IT CHECKS                                      │ HAS cType?
 *   ──────────────────────────┼─────────────────────────────────────────────────────┼───────────
 *   cf_chl_opt                │ window._cf_chl_opt exists                           │ YES
 *   challenge_element         │ #challenge-form, #challenge-stage, #challenge-running│ No
 *   challenge_running_class   │ html.challenge-running CSS class                     │ No
 *   title_interstitial        │ Title: "just a moment", "momento", etc.              │ No
 *   body_text_challenge       │ Body: "verify you are human", etc.                   │ No
 *   cf_error_page             │ .cf-error-details, #cf-error-details                 │ No
 *   ray_id_footer             │ Footer contains "ray id" + "cloudflare"              │ No
 *
 * Additional sources (not from CF_DETECTION_JS):
 *   runtime_poll              │ JS poll finds turnstile on page (set in solver)       │ No
 *   hasTurnstileIframe        │ challenges.cloudflare.com iframe present (separate)   │ No
 */
export function detectCloudflareType(
  _pageUrl: string,
  detectionResult: { detected: boolean; method?: string; cType?: string },
  hasTurnstileIframe: boolean,
): CloudflareType | null {
  if (!detectionResult.detected) return null;
  const cType = detectionResult.cType;

  // ── _cf_chl_opt exists → use CF's own mode classification ──
  if (cType === 'managed' || cType === 'interactive') return 'managed';
  if (cType === 'non-interactive') return 'non_interactive';
  if (cType === 'invisible') return 'invisible';

  // ── No _cf_chl_opt → classify by detection method ──

  // CF challenge pages (full-page "Just a moment..." interstitials)
  if (detectionResult.method === 'title_interstitial') return 'interstitial';
  if (detectionResult.method === 'body_text_challenge') return 'interstitial';
  if (detectionResult.method === 'challenge_element') return 'interstitial';
  if (detectionResult.method === 'challenge_running_class') return 'interstitial';

  // CF error pages (1006, 1015, etc.) — not solvable
  if (detectionResult.method === 'cf_error_page') return 'block';

  // Soft CF indicator with visible Turnstile → standalone widget
  // Without Turnstile → interstitial (CF page without standard markers)
  if (detectionResult.method === 'ray_id_footer') {
    return hasTurnstileIframe ? 'turnstile' : 'interstitial';
  }

  // Turnstile iframe on non-CF page → standalone widget (mode unknown)
  if (hasTurnstileIframe) return 'turnstile';

  // Fallback: detected but no specific method matched
  return 'interstitial';
}

/**
 * ═══════════════════════════════════════════════════════════════════════
 * Cloudflare Turnstile — Official Widget Error States
 * https://developers.cloudflare.com/turnstile/concepts/widget/
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. UNKNOWN ERROR         — error during challenge, widget shows error message
 * 2. INTERACTION TIMED OUT — checkbox shown but visitor didn't click in time
 * 3. CHALLENGE TIMED OUT   — token expired, visitor didn't submit form in time
 * 4. UNSUPPORTED BROWSER   — outdated/unsupported browser (N/A for us — we control Chrome)
 *
 * Our detection:
 *   CDP OOPIF DOM walk         │ DOM.getDocument on OOPIF session, check #success/#fail/#expired/#timeout
 *     'success'                │ → challenge solved
 *     'fail'                   │ → maps to CF "Unknown error"
 *     'timeout'                │ → maps to CF "Interaction timed out"
 *     'expired'                │ → maps to CF "Challenge timed out"
 *
 *   TURNSTILE_ERROR_CHECK_JS     │ Polling check (activity loop)
 *     'confirmed_error'          │ → error/failed text in widget, no token
 *     'error_text'               │ → error/failed text in widget, has token
 *     'iframe_error'             │ → error/failed text in iframe content
 *     'expired'                  │ → turnstile.isExpired() returned true
 */

/**
 * JS to detect Turnstile widget error states.
 * Checks container text for error indicators and turnstile.isExpired().
 * Returns error type string or null.
 */
export const TURNSTILE_ERROR_CHECK_JS = `JSON.stringify((function() {
  var hasToken = false;
  try {
    if (typeof turnstile !== 'undefined' && turnstile.getResponse) {
      var t = turnstile.getResponse();
      if (t && t.length > 0) hasToken = true;
    }
  } catch(e) {}
  if (!hasToken) {
    var inp = document.querySelector('[name="cf-turnstile-response"]');
    if (inp && inp.value && inp.value.length > 0) hasToken = true;
  }

  var containers = document.querySelectorAll(
    '[class*="cf-turnstile"], [id^="cf-chl-widget"], [data-sitekey]'
  );
  for (var i = 0; i < containers.length; i++) {
    var text = (containers[i].textContent || '').toLowerCase();
    if (text.includes('error') || text.includes('failed') || text.includes('try again'))
      return { type: hasToken ? 'error_text' : 'confirmed_error', has_token: hasToken };
  }

  var cfIframes = document.querySelectorAll('iframe[src*="challenges.cloudflare.com"], iframe[name^="cf-chl-widget"]');
  for (var i = 0; i < cfIframes.length; i++) {
    try {
      var doc = cfIframes[i].contentDocument;
      if (doc && doc.body) {
        var iText = (doc.body.textContent || '').toLowerCase();
        if (iText.includes('error') || iText.includes('failed') || iText.includes('try again'))
          return { type: hasToken ? 'iframe_error' : 'confirmed_error', has_token: hasToken };
      }
    } catch(e) {}
  }

  if (typeof turnstile !== 'undefined' && turnstile.isExpired) {
    try {
      var ws = document.querySelectorAll('[id^="cf-chl-widget"]');
      for (var i = 0; i < ws.length; i++) {
        if (turnstile.isExpired(ws[i].id))
          return { type: 'expired', has_token: hasToken };
      }
    } catch(e) {}
  }
  return null;
})()`;

/**
 * ═══════════════════════════════════════════════════════════════════════
 * CF Fingerprint Audit — diagnostic injection
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ported from cloudflare-jsd/get_fingerprint.js
 *
 * Creates a hidden iframe (same technique CF uses internally) and
 * enumerates all properties on window, navigator, and document.
 * Classifies each property by CF's type encoding (o, N, F, T, etc.)
 * and compares against the expected fingerprint from fp.go.
 *
 * Returns JSON with:
 *   - mismatches: properties where our browser differs from expected
 *   - critical: high-priority mismatches (webdriver, native functions, etc.)
 *   - sample: first 30 captured property classifications
 *   - counts: total properties per type
 */
export const CF_FINGERPRINT_AUDIT_JS = `JSON.stringify((function() {
  try {
    var S = document;
    var n = {object:'o',string:'s',undefined:'u',symbol:'z',number:'n',bigint:'I',boolean:'b'};

    function isNative(E, fn) {
      try {
        return fn instanceof E.Function &&
          E.Function.prototype.toString.call(fn).indexOf('[native code]') > -1;
      } catch(e) { return false; }
    }

    function classifyProp(E, obj, key) {
      try {
        var val = obj[key];
        if (val && typeof val.catch === 'function') return 'p';
      } catch(e) {}
      try {
        if (obj[key] == null) return obj[key] === undefined ? 'u' : 'x';
      } catch(e) { return 'i'; }
      var val = obj[key];
      if (E.Array.isArray(val)) return 'a';
      if (val === E.Array) return 'q0';
      if (val === true) return 'T';
      if (val === false) return 'F';
      var t = typeof val;
      if (t === 'function') return isNative(E, val) ? 'N' : 'f';
      return n[t] || '?';
    }

    function getAllKeys(obj) {
      var keys = [];
      var cur = obj;
      while (cur !== null) {
        keys = keys.concat(Object.keys(cur));
        try { cur = Object.getPrototypeOf(cur); } catch(e) { break; }
      }
      if (typeof Object.getOwnPropertyNames === 'function') {
        try { keys = keys.concat(Object.getOwnPropertyNames(obj)); } catch(e) {}
      }
      // Deduplicate
      var seen = {};
      var unique = [];
      for (var i = 0; i < keys.length; i++) {
        if (!seen[keys[i]]) { seen[keys[i]] = true; unique.push(keys[i]); }
      }
      return unique;
    }

    function enumerate(E, obj, prefix, result) {
      if (obj == null) return result;
      var keys = getAllKeys(obj);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var cls = classifyProp(E, obj, key);
        var fullKey = prefix + key;
        if (!result[cls]) result[cls] = [];
        result[cls].push(fullKey);
      }
      return result;
    }

    // Create hidden iframe — same as CF's technique
    // Wait for body to be available (CF interstitial pages load body async)
    if (!S.body) return {error: 'no_body', readyState: S.readyState};
    var iframe = S.createElement('iframe');
    iframe.style.display = 'none';
    iframe.tabIndex = -1;
    S.body.appendChild(iframe);
    var W = iframe.contentWindow;
    var D = iframe.contentDocument;
    if (!W || !D) { try { S.body.removeChild(iframe); } catch(e){} return {error: 'no_iframe_window'}; }

    var fp = {};
    fp = enumerate(W, W, '', fp);
    fp = enumerate(W, W.clientInformation || W.navigator, 'n.', fp);
    fp = enumerate(W, D, 'd.', fp);
    S.body.removeChild(iframe);

    // Expected values from cloudflare-jsd/fp.go
    var expected = {
      'F': ['closed','crossOriginIsolated','credentialless','n.webdriver',
            'n.deprecatedRunAdAuctionEnforcesKAnonymity','d.xmlStandalone','d.hidden',
            'd.wasDiscarded','d.prerendering','d.webkitHidden','d.fullscreen','d.webkitIsFullScreen'],
      'T': ['isSecureContext','originAgentCluster','offscreenBuffering',
            'n.pdfViewerEnabled','n.cookieEnabled','n.onLine',
            'd.fullscreenEnabled','d.webkitFullscreenEnabled','d.pictureInPictureEnabled','d.isConnected'],
      'N_sample': ['alert','atob','blur','btoa','fetch','Object','Function','Number','Boolean',
                   'String','Date','Promise','Map','Set','eval','isNaN','WebSocket',
                   'd.getElementById','d.querySelector','d.createElement'],
      // Note: 'Array' intentionally excluded — CF's classifier returns 'q0' for it
      // (val === E.Array check runs before the typeof==='function' check)
      'o_sample': ['window','self','document','navigator','screen','crypto','console','JSON','Math',
                   'n.geolocation','n.plugins','n.clipboard','n.mediaDevices','n.userAgentData'],
    };

    // Check critical mismatches
    var mismatches = [];
    var critical = [];

    // Check booleans that should be False
    var fpF = fp['F'] || [];
    for (var i = 0; i < expected['F'].length; i++) {
      var prop = expected['F'][i];
      if (fpF.indexOf(prop) === -1) {
        // Find what type it actually is
        var actual = '?';
        for (var t in fp) {
          if (fp[t].indexOf(prop) !== -1) { actual = t; break; }
        }
        var entry = {prop: prop, expected: 'F', actual: actual};
        mismatches.push(entry);
        if (prop === 'n.webdriver') critical.push(entry);
      }
    }

    // Check booleans that should be True
    var fpT = fp['T'] || [];
    for (var i = 0; i < expected['T'].length; i++) {
      var prop = expected['T'][i];
      if (fpT.indexOf(prop) === -1) {
        var actual = '?';
        for (var t in fp) {
          if (fp[t].indexOf(prop) !== -1) { actual = t; break; }
        }
        mismatches.push({prop: prop, expected: 'T', actual: actual});
      }
    }

    // Check native functions (should be 'N', not 'f' or missing)
    var fpN = fp['N'] || [];
    for (var i = 0; i < expected['N_sample'].length; i++) {
      var prop = expected['N_sample'][i];
      if (fpN.indexOf(prop) === -1) {
        var actual = '?';
        for (var t in fp) {
          if (fp[t].indexOf(prop) !== -1) { actual = t; break; }
        }
        if (actual !== 'N') {
          var entry = {prop: prop, expected: 'N', actual: actual};
          mismatches.push(entry);
          // Functions that should be native but aren't = puppeteer-stealth patches leaked
          if (actual === 'f') critical.push(entry);
        }
      }
    }

    // Check objects
    var fpO = fp['o'] || [];
    for (var i = 0; i < expected['o_sample'].length; i++) {
      var prop = expected['o_sample'][i];
      if (fpO.indexOf(prop) === -1) {
        var actual = '?';
        for (var t in fp) {
          if (fp[t].indexOf(prop) !== -1) { actual = t; break; }
        }
        if (actual !== 'o') mismatches.push({prop: prop, expected: 'o', actual: actual});
      }
    }

    // Also check specific string values that CF validates
    var strChecks = [];
    try { strChecks.push({prop:'n.vendor', val: (W || window).navigator?.vendor, expected: 'Google Inc.'}); } catch(e){}
    try { strChecks.push({prop:'n.platform', val: navigator.platform, expected: 'Linux x86_64'}); } catch(e){}
    try { strChecks.push({prop:'n.webdriver', val: navigator.webdriver, expected: false}); } catch(e){}
    try { strChecks.push({prop:'n.languages', val: JSON.stringify(navigator.languages), expected: '["en-US","en"]'}); } catch(e){}
    try { strChecks.push({prop:'n.hardwareConcurrency', val: navigator.hardwareConcurrency}); } catch(e){}
    try { strChecks.push({prop:'n.deviceMemory', val: navigator.deviceMemory}); } catch(e){}
    try { strChecks.push({prop:'n.maxTouchPoints', val: navigator.maxTouchPoints, expected: 0}); } catch(e){}
    try { strChecks.push({prop:'n.pdfViewerEnabled', val: navigator.pdfViewerEnabled, expected: true}); } catch(e){}
    try { strChecks.push({prop:'n.cookieEnabled', val: navigator.cookieEnabled, expected: true}); } catch(e){}

    // Puppeteer/automation specific checks
    try { strChecks.push({prop:'window.chrome', val: typeof window.chrome, expected: 'object'}); } catch(e){}
    try { strChecks.push({prop:'window.chrome.runtime', val: typeof window.chrome?.runtime}); } catch(e){}
    try { strChecks.push({prop:'Notification.permission', val: typeof Notification !== 'undefined' ? Notification.permission : 'N/A'}); } catch(e){}
    try { strChecks.push({prop:'navigator.permissions.query', val: typeof navigator.permissions?.query, expected: 'function'}); } catch(e){}

    // Count properties per type
    var counts = {};
    for (var t in fp) { counts[t] = fp[t].length; }

    // List ALL non-native functions (f) — these are automation artifacts CF can detect
    var nonNativeFns = (fp['f'] || []).slice(0, 20);

    // Check for Runtime.addBinding globals (CDP bindings are visible on window)
    var bindingCheck = [];
    var bindingNames = ['__csrfp','__perf','__turnstileSolvedBinding',
                        '__cfEventSpy','__turnstileSolved'];
    for (var bi = 0; bi < bindingNames.length; bi++) {
      var bname = bindingNames[bi];
      try {
        if (typeof window[bname] !== 'undefined') {
          bindingCheck.push({name: bname, type: typeof window[bname]});
        }
      } catch(e) {}
    }

    return {
      mismatches: mismatches.slice(0, 30),
      critical: critical,
      string_checks: strChecks,
      counts: counts,
      total_props: Object.values(fp).reduce(function(a,b){return a+b.length;}, 0),
      webdriver_raw: navigator.webdriver,
      non_native_fns: nonNativeFns,
      visible_bindings: bindingCheck,
    };
  } catch(e) {
    return {error: e.message || String(e)};
  }
})())`;
