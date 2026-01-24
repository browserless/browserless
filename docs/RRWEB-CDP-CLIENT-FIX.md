# Browserless rrweb Session Recording Fix for CDP Clients (Pydoll)

## TL;DR - What Was Fixed

Three separate issues were fixed to make rrweb session recordings work with CDP clients like Pydoll:

| Issue | Root Cause | Fix | File |
|-------|-----------|-----|------|
| **Recording not starting** | Pydoll uses existing tabs, not `newPage()` | Connect internal Puppeteer to browser, set up recording for all tabs | `src/browsers/index.ts` |
| **Events lost on navigation** | 1-second polling + page unload destroys in-memory events | Collect events on `Page.frameStartedLoading` BEFORE navigation | `src/browsers/index.ts` |
| **CDP session isolation** | `addScriptToEvaluateOnNewDocument` may not fire for navigations from other CDP sessions | Re-inject on `Page.frameNavigated`, `Page.loadEventFired`, `Page.domContentEventFired` | `src/browsers/index.ts` |
| **Self-healing too slow** | 1-second check interval | Reduced to 200ms polling | `src/browsers/index.ts` |
| **Concurrent scraper cleanup race** | `get_browser_id()` returned newest session, not calling scraper's session | Use `trackingId` param to identify own session | `pydoll-scraper/src/evasion/browser.py` |

---

## Issue 1: Recording Not Starting for CDP Clients

### The Problem

**Symptom:** `eventCount: 0` in recordings for Pydoll, but works for Puppeteer.

**Why it happens:**

| Client | How it works | Recording setup |
|--------|--------------|-----------------|
| Puppeteer | Calls `browser.newPage()` through Browserless wrapper | Browserless intercepts, emits `newPage` event, calls `setupPageRecording()` |
| Pydoll (CDP) | Connects directly to Chrome via CDP, uses `get_opened_tabs()[0]` (existing tab) | `newPage` event never fires, recording never set up |

### The Fix

**Solution:** When `?replay=true` is passed, Browserless connects its own internal Puppeteer instance to the browser and sets up recording for ALL tabs (existing + future).

**Code location:** `src/browsers/index.ts` → `setupRecordingForAllTabs()`

```typescript
// Connect to browser (not page) WebSocket endpoint
const puppeteer = await import('puppeteer-core');
const pptr = await puppeteer.default.connect({
  browserWSEndpoint: wsEndpoint,  // Browser-level, not page-level
  defaultViewport: null,
});

// Listen for NEW tabs created after this point
pptr.on('targetcreated', async (target) => {
  if (target.type() !== 'page') return;
  const page = await target.page();
  if (page) await setupRecordingForPage(page, 'new');
});

// Set up recording for EXISTING tabs (including the one Pydoll will use)
const pages = await pptr.pages();
for (const page of pages) {
  await setupRecordingForPage(page, 'existing');
}
```

**Why internal Puppeteer?** We need a reliable way to get Page objects with CDP access. Puppeteer gives us this. The internal connection is separate from Pydoll's - they don't interfere.

---

## Issue 2: Events Lost During Navigation

### The Problem

**Symptom:** Recording exists but missing events, especially around page navigations.

**Why it happens:**

1. rrweb stores events in `window.__browserlessRecording.events` (JavaScript array in page memory)
2. When page navigates, the old document unloads → **array is destroyed**
3. If `collectEvents()` hasn't run recently, those events are lost forever
4. Original polling interval was 1000ms → up to 1 second of events lost per navigation

```
Timeline (OLD - 1 second polling):
[User clicks link] ... [Page starts unloading] ... [OLD PAGE DESTROYED] ... [1000ms] ... [Poll runs - TOO LATE]
                                                    ^ Events gone forever
```

### The Fix

**Solution 1:** Collect events BEFORE navigation starts using `Page.frameStartedLoading` CDP event.

```typescript
// Page.frameStartedLoading fires when navigation begins, BEFORE old document unloads
emitter.on('Page.frameStartedLoading', async () => {
  await collectEvents();  // Save events before they're destroyed
});
```

**Solution 2:** Reduce polling interval from 1000ms to 200ms as backup.

```typescript
const intervalId = setInterval(collectEvents, 200);  // Was 1000ms
```

```
Timeline (NEW - event-driven + 200ms polling):
[User clicks] → [frameStartedLoading: COLLECT] → [Page unloads] → [New page loads] → [200ms poll backup]
                ^ Events saved immediately!
```

---

## Issue 3: CDP Session Isolation

### The Problem

**Symptom:** rrweb script doesn't run after Pydoll navigates to a new page.

**Why it happens:**

Chrome DevTools Protocol has **session isolation**. When Browserless registers `Page.addScriptToEvaluateOnNewDocument` on its internal Puppeteer CDP session, it might not execute for navigations triggered by a different CDP session (Pydoll's session).

```
Browserless Internal Session          Pydoll's Session
         │                                   │
         │ addScriptToEvaluateOnNewDocument  │
         │ (registered here)                 │
         │                                   │
         │                                   │ tab.go_to("https://...")
         │                                   │ (navigation triggered here)
         │                                   │
         ▼                                   ▼
    Script might NOT run because navigation came from different session
```

### The Fix

**Solution:** Listen for navigation events at the CDP level and re-inject rrweb immediately after ANY navigation completes, regardless of which session triggered it.

```typescript
const injectAfterNavigation = async (source: string) => {
  await new Promise((r) => setTimeout(r, 50));  // Let page initialize
  try {
    if (page.isClosed()) return;
    await cdp.send('Runtime.evaluate', {
      expression: script,  // Full rrweb script
      returnByValue: true,
    });
  } catch {
    // Page might not be ready, self-healing will catch it
  }
};

// Listen for multiple navigation events for redundancy
emitter.on('Page.frameNavigated', () => injectAfterNavigation('frameNavigated'));
emitter.on('Page.loadEventFired', () => injectAfterNavigation('loadEventFired'));
emitter.on('Page.domContentEventFired', () => injectAfterNavigation('domContentEventFired'));
```

**Why multiple events?** Different pages emit these at different times. Listening to all three ensures we inject as early as possible.

---

## Issue 4: Concurrent Scraper Session Cleanup Race Condition

### The Problem

**Symptom:** When running multiple Pydoll scrapers concurrently:
- Sessions accumulate and never get cleaned up
- Hit Browserless concurrent session limit (e.g., 20)
- No recordings created (sessions don't end properly)
- Memory leak on Browserless server

**Why it happens:**

Pydoll's `get_browser_id()` function found the session to kill by selecting the **newest** session:

```python
# WRONG - browser.py (old code)
async def get_browser_id(http_endpoint: str) -> str | None:
    sessions = await response.json()
    newest = max(sessions, key=lambda s: s.get("startedOn", 0))  # BUG!
    return newest.get("id")
```

With concurrent scrapers:
```
Scraper A starts → Session A created (startedOn: 1000)
Scraper B starts → Session B created (startedOn: 1001)
Scraper A finishes → get_browser_id() returns Session B (newest!) → kills wrong session
Scraper B finishes → get_browser_id() returns Session B → already dead, no-op
Session A: NEVER CLEANED UP
```

### The Fix

**Solution:** Use Browserless's `trackingId` parameter to uniquely identify each scraper's session.

**File:** `packages/pydoll-scraper/src/evasion/browser.py`

```python
import uuid

async def get_websocket_url(http_endpoint: str, launch_query: str | None = None) -> tuple[str, str]:
    """Returns (ws_url, tracking_id) tuple."""
    # ... existing code ...

    # Generate unique tracking ID for THIS scraper's session
    tracking_id = str(uuid.uuid4())[:16]

    params = [f"timeout={SESSION_TIMEOUT_MS}", "replay=true", f"trackingId={tracking_id}"]
    if launch_query:
        params.insert(0, launch_query)

    ws_url = f"{ws_url}?{'&'.join(params)}"
    return ws_url, tracking_id


async def get_browser_id(http_endpoint: str, tracking_id: str) -> str | None:
    """Find OUR session by trackingId, not newest."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"{http_endpoint}/sessions") as response:
            sessions = await response.json()

            # Find OUR session by trackingId
            for s in sessions:
                if s.get("trackingId") == tracking_id:
                    return s.get("id")

            return None
```

**Browserless `trackingId` rules** (from `src/browsers/index.ts`):
- Max 32 characters
- Alphanumeric + dash + underscore only: `+([0-9a-zA-Z-_])`
- Cannot be reserved word `"all"`
- Must be unique (returns 400 if duplicate exists)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           BROWSERLESS SERVER                             │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    getBrowserForRequest()                          │ │
│  │                                                                    │ │
│  │  1. Launch Chrome browser                                          │ │
│  │  2. If ?replay=true: startRecording(sessionId, trackingId)         │ │
│  │  3. setupRecordingForAllTabs(browser, sessionId)                   │ │
│  │     │                                                              │ │
│  │     ├── Connect internal Puppeteer to browser WebSocket            │ │
│  │     ├── Set up targetcreated listener for new tabs                 │ │
│  │     ├── Wait for initial page (handles waitForInitialPage: false)  │ │
│  │     │                                                              │ │
│  │     └── For each page: setupPageRecording(page, sessionId)         │ │
│  │         ├── Page.enable (required for CDP events)                  │ │
│  │         ├── Page.addScriptToEvaluateOnNewDocument (rrweb)          │ │
│  │         ├── Runtime.evaluate (immediate injection)                 │ │
│  │         ├── Listen: Page.frameStartedLoading → collectEvents()     │ │
│  │         ├── Listen: Page.frameNavigated → re-inject rrweb          │ │
│  │         ├── Listen: Page.loadEventFired → re-inject rrweb          │ │
│  │         ├── Listen: Page.domContentEventFired → re-inject rrweb    │ │
│  │         ├── setInterval(collectEvents, 200ms)                      │ │
│  │         └── registerFinalCollector(collectEvents)                  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                        CHROME BROWSER                              │ │
│  │                                                                    │ │
│  │   ┌──────────────────────────────────────────────────────────┐    │ │
│  │   │  Tab (with rrweb recording active)                       │    │ │
│  │   │                                                          │    │ │
│  │   │  window.__browserlessRecording = {                       │    │ │
│  │   │    events: [...],     // DOM mutations captured here     │    │ │
│  │   │    sessionId: "..."   // Links to Browserless session    │    │ │
│  │   │  }                                                       │    │ │
│  │   │                                                          │    │ │
│  │   │  window.__browserlessStopRecording = fn  // rrweb handle │    │ │
│  │   │  window.rrweb = { record: fn, ... }      // rrweb lib    │    │ │
│  │   └──────────────────────────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    ▲                                     │
│                                    │                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    PYDOLL (CDP CLIENT)                             │ │
│  │                                                                    │ │
│  │  1. Connect: ws://browserless:3000?replay=true&trackingId=abc123   │ │
│  │  2. get_opened_tabs() → uses tabs[0]                               │ │
│  │  3. tab.go_to("https://ahrefs.com/...")                            │ │
│  │  4. Scrape data, handle Turnstile, etc.                            │ │
│  │  5. Disconnect (triggers session close)                            │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                    │                                     │
│                                    ▼                                     │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                    SESSION CLOSE FLOW                              │ │
│  │                                                                    │ │
│  │  1. Pydoll disconnects WebSocket                                   │ │
│  │  2. Browserless detects disconnect                                 │ │
│  │  3. stopRecording(sessionId) called                                │ │
│  │     ├── Run finalCollectors (last collectEvents())                 │ │
│  │     ├── isRecording = false                                        │ │
│  │     ├── Save events to /recordings/{sessionId}.json                │ │
│  │     └── Run cleanupFns (pptr.disconnect())                         │ │
│  │  4. browser.close()                                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Files Modified Summary

### Browserless (`/Users/peter/Developer/browserless`)

| File | Changes |
|------|---------|
| `src/browsers/index.ts` | Added `setupRecordingForAllTabs()`, CDP event listeners (`Page.frameStartedLoading`, `Page.frameNavigated`, `Page.loadEventFired`, `Page.domContentEventFired`), reduced polling to 200ms |
| `src/session-replay.ts` | Added `finalCollectors`, `cleanupFns` to `SessionRecordingState`, `registerFinalCollector()`, `registerCleanupFn()` methods |

### Pydoll Scraper (`/Users/peter/Developer/catchseo/packages/pydoll-scraper`)

| File | Changes |
|------|---------|
| `src/evasion/browser.py` | `get_websocket_url()` now returns `(url, tracking_id)` tuple, `get_browser_id()` finds session by `trackingId` instead of newest |

---

## Testing & Verification

### Build Browserless
```bash
cd /Users/peter/Developer/browserless
npm run build
```

### Deploy
```bash
bunx sst deploy
```

### Test Single Scraper
```bash
cd /Users/peter/Developer/catchseo/packages/pydoll-scraper
LOCAL_MOBILE_PROXY=$(op read "op://Catchseo.com/Proxies/local_mobile_proxy") \
  uv run pydoll ahrefs example.com --chrome-endpoint=browserless

# Check recording created with events
curl -s http://192.168.4.200:3000/recordings | jq '.[0] | {id, eventCount, duration}'
# Should show eventCount > 0
```

### Test Concurrent Scrapers (Session Cleanup)
```bash
# Run 5 scrapers in parallel
for i in {1..5}; do
  LOCAL_MOBILE_PROXY=$(op read "op://Catchseo.com/Proxies/local_mobile_proxy") \
    uv run pydoll ahrefs domain$i.com --chrome-endpoint=browserless &
done
wait

# Verify all sessions cleaned up
curl -s http://192.168.4.200:3000/sessions | jq 'length'
# Should return 0

# Verify all recordings created
curl -s http://192.168.4.200:3000/recordings | jq 'length'
# Should return 5
```

### Debug Recording Issues
```bash
# Check if rrweb is active in page
curl -s http://192.168.4.200:3000/sessions | jq '.[0]'

# Look for these log messages in Browserless:
# - "Re-injected rrweb (frameNavigated)" - CDP isolation fix working
# - "Collected events before navigation" - Event loss fix working
# - "collectEvents: url=..., eventCount=N" - Recording active
```

---

## Diagnostic Guide

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| `eventCount: 0` | Recording never started | Check `setupRecordingForAllTabs()` is being called, verify `?replay=true` in WebSocket URL |
| Events missing after navigation | `Page.frameStartedLoading` not firing | Check Page.enable was called, verify CDP connection is alive |
| Recording works first page, not after navigate | CDP session isolation | Check `Page.frameNavigated` listener is attached and re-injecting |
| Sessions accumulating | `trackingId` not being used | Verify `get_browser_id()` is filtering by `trackingId` |
| Recording file empty | `stopRecording()` called before events collected | Check `finalCollectors` are registered and running |

---

## Key Insights

1. **CDP clients (Pydoll) bypass Browserless's page lifecycle hooks** - They connect directly to Chrome and use existing tabs, so `newPage` events never fire.

2. **`Page.addScriptToEvaluateOnNewDocument` has session isolation** - Scripts registered by one CDP session may not run for navigations triggered by another session. Must re-inject on navigation events.

3. **Page navigation destroys JavaScript state** - Events stored in `window.__browserlessRecording.events` are lost when page unloads. Must collect BEFORE navigation starts.

4. **Concurrent scrapers need unique identifiers** - Using "newest session" to find your session fails with multiple scrapers. Use `trackingId` parameter.

5. **Multiple CDP connections to same browser work fine** - Browserless's internal Puppeteer and Pydoll's CDP connection don't interfere with each other.
