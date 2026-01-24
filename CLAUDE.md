# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browserless is a headless browser service that allows remote clients to connect and execute browser automation via Docker. It supports Puppeteer and Playwright libraries, and provides REST APIs for PDF generation, screenshots, scraping, and more.

## Build & Development Commands

```bash
# Full build (TypeScript + adblock + schemas + devtools + OpenAPI docs)
npm run build

# Development build with debugger
npm run build:dev

# Run development server (builds first, then starts with .env config)
npm run dev

# Start without rebuilding
npm start

# Run tests (builds test artifacts first)
npm run test

# Run single test file
npx mocha build/path/to/file.spec.js

# Lint and fix
npm run lint

# Format code
npm run prettier

# Install browsers locally for development
npm run install:browsers
```

## Architecture

### Core System (`src/`)

- **`browserless.ts`** - Main `Browserless` class that orchestrates the entire system. Initializes all modules, loads routes dynamically, and manages the server lifecycle.
- **`server.ts`** - HTTP server handling incoming requests and WebSocket upgrades
- **`router.ts`** - Route registration and request matching
- **`limiter.ts`** - Concurrency control and request queuing
- **`config.ts`** - Configuration management via environment variables

### Browser Management (`src/browsers/`)

- **`index.ts`** - `BrowserManager` class handles browser lifecycle (launching, session tracking, reconnection, cleanup)
- **`browsers.cdp.ts`** - CDP-based browser implementations (ChromiumCDP, ChromeCDP, EdgeCDP)
- **`browsers.playwright.ts`** - Playwright browser implementations (ChromiumPlaywright, FirefoxPlaywright, WebKitPlaywright)

### Route System (`src/routes/`)

Routes are organized by browser type: `chrome/`, `chromium/`, `edge/`, `firefox/`, `webkit/`, `management/`

Each browser folder contains:
- `http/` - REST API routes (e.g., `pdf.post.ts`, `screenshot.post.ts`)
- `ws/` - WebSocket routes (e.g., `browser.ts`, `playwright.ts`)
- `tests/` - Test files

Route naming convention: `{action}.{method}.ts` (e.g., `pdf.post.ts`, `json-list.get.ts`)

### Shared Route Logic (`src/shared/`)

Browser-specific routes often re-export from shared implementations:
```typescript
// src/routes/chromium/http/pdf.post.ts
export { default } from '../../../shared/pdf.http.js';
```

### Route Types

Four route primitives (defined in `src/types.ts`):
- **`HTTPRoute`** - Basic HTTP route without browser
- **`BrowserHTTPRoute`** - HTTP route that requires a browser instance
- **`WebSocketRoute`** - WebSocket route without browser
- **`BrowserWebsocketRoute`** - WebSocket route that requires a browser instance

Routes specify: `name`, `path`, `method`, `accepts`, `contentTypes`, `auth`, `concurrency`, `browser` (class), and `handler`.

### Schema Generation

Routes export TypeScript interfaces (`BodySchema`, `QuerySchema`, `ResponseSchema`) that are automatically converted to:
- Runtime JSON Schema validation
- OpenAPI documentation (served at `/docs`)

### Docker Images

Located in `docker/` with browser-specific Dockerfiles:
- `base/` - Base image with Node.js and browserless core
- `chromium/`, `chrome/`, `firefox/`, `webkit/`, `edge/` - Single browser images
- `multi/` - All browsers combined
- `sdk/` - For SDK extensions

## Key Patterns

### Adding a New Route

1. Create file with naming convention `{action}.{method}.ts` in appropriate browser folder
2. Export `BodySchema`, `QuerySchema`, `ResponseSchema` interfaces for auto-documentation
3. Extend appropriate route class (`HTTPRoute`, `BrowserHTTPRoute`, etc.)
4. Implement required properties: `name`, `path`, `method`, `accepts`, `contentTypes`, `tags`, `handler`

### Extending via SDK

The SDK allows extending browserless functionality. Key extension points:
- Custom routes (`*.http.ts`, `*.websocket.ts`)
- Module overrides: `config.ts`, `hooks.ts`, `limiter.ts`, `metrics.ts`, etc.
- Disabled routes via `disabled-routes.ts`

Run `npx @browserless.io/browserless create` to scaffold an SDK project.

### Environment Configuration

Key environment variables (see `src/config.ts`):
- `PORT` - Server port (default: 3000)
- `TOKEN` - Authentication token
- `CONCURRENT` - Max concurrent sessions
- `QUEUED` - Max queued requests
- `TIMEOUT` - Request timeout in ms

## Testing

Tests use Mocha with Chai assertions. Test files are colocated with routes in `tests/` directories.

```bash
# Run all tests
npm test

# Run specific test file
npx mocha build/src/routes/chromium/tests/pdf.spec.js
```

## Code Style

- TypeScript with strict mode
- ESM modules (`"type": "module"`)
- Imports must use `.js` extensions (for ESM compatibility)
- Sorted imports (enforced by ESLint)
- Semicolons required
- Single quotes, trailing commas
- Node.js >= 24 required

## Module Extension Pattern

All core modules can be overridden by extending and default-exporting:

```typescript
// src/config.ts in SDK project
import { Config } from '@browserless.io/browserless';

export default class MyConfig extends Config {
  public getCustomSetting(): string {
    return process.env.CUSTOM_SETTING ?? 'default';
  }
}
```

Every module has a `stop()` method (left blank) that SDK extensions can override for cleanup on shutdown.

## Hooks System

Four lifecycle hooks in `src/hooks.ts`:
- `before({ req, res?, socket?, head? })` - Before request processing. Return `false` to reject (you must write response).
- `after({ req, start, status, error? })` - After request completion
- `page({ meta, page })` - On new Page creation
- `browser({ browser, req })` - On new Browser launch

Legacy hook injection via `external/*.js` files (before.js, after.js, browser.js, page.js).

## Key Utilities

Import from `@browserless.io/browserless`:
- `writeResponse(res, code, message)` / `jsonResponse(res, code, object)` - Response helpers
- `readBody(req, maxSize)` - Parse request body
- `BadRequest`, `Unauthorized`, `NotFound`, `Timeout`, `TooManyRequests`, `ServerError` - Error classes (throw to return appropriate HTTP codes)
- `availableBrowsers` - Promise of installed browser classes
- `sleep(ms)`, `exists(path)`, `safeParse(json)`, `dedent()` - General utilities

## External CDP Client Support (Pydoll, Playwright, etc.)

### Problem Solved

External CDP clients that connect via `/json/new` or WebSocket were experiencing CDP command timeouts because:
1. Puppeteer-stealth was attaching to ALL page targets (internal and external)
2. Recording used `flatten=true` attachment which created competing CDP sessions

### Key Fixes in `src/browsers/browsers.cdp.ts`

**1. `pendingInternalPage` Flag** - Differentiates internal vs external page creation:

```typescript
// In ChromiumCDP class
protected pendingInternalPage = false;

public async newPage(): Promise<Page> {
  this.pendingInternalPage = true;  // Mark next target as internal
  const page = await this.browser.newPage();
  this.pendingInternalPage = false; // Reset after creation
  return page;
}

protected async onTargetCreated(target: Target) {
  if (target.type() === 'page') {
    // CRITICAL: Only attach puppeteer to targets WE created
    if (!this.pendingInternalPage) {
      // Skip external targets - don't attach puppeteer/stealth
      return;
    }
    // ... rest of handler for internal pages only
  }
}
```

**Why this matters:** External clients (pydoll, raw CDP) create targets via `/json/new`. Puppeteer-stealth hooks (`onPageCreated`) were sending CDP commands that raced with the external client's commands, causing timeouts.

### Key Fixes in `src/browsers/index.ts`

**2. Recording with `flatten=false`** - Non-invasive recording for external clients:

```typescript
// Use flatten=false to avoid dedicated CDP sessions
const attachResult = await sendCommand('Target.attachToTarget', {
  targetId,
  flatten: false,  // Less invasive than flatten=true
});

// With flatten=false, commands must use Target.sendMessageToTarget
const innerCommand = JSON.stringify({ id, method, params });
await sendCommand('Target.sendMessageToTarget', {
  sessionId: cdpSessionId,
  message: innerCommand,
});

// Responses come via Target.receivedMessageFromTarget events
if (msg.method === 'Target.receivedMessageFromTarget') {
  const innerMsg = JSON.parse(msg.params.message);
  // Route response to pending command handler
}
```

**Why `flatten=false`:**
- `flatten=true`: Creates dedicated CDP session that can block external clients
- `flatten=false`: Uses browser WebSocket, commands/responses via `sendMessageToTarget`/`receivedMessageFromTarget`

### Recording Player Fix in `src/routes/management/http/recording-player.get.ts`

**3. rrwebPlayer Constructor** - The bundled player exports an object, not a constructor:

```typescript
// rrwebPlayer is bundled as {Player, default} not a direct constructor
const Player = rrwebPlayer.default || rrwebPlayer.Player || rrwebPlayer;
new Player({ target, props: { events, ... } });
```

## Session Replay System

### How It Works

1. **Initialization**: When `replay=true` query param is passed, `SessionReplay` starts recording
2. **rrweb Injection**: Script injected via `Runtime.evaluate` captures DOM mutations, mouse movements, etc.
3. **Event Collection**: Events polled every 500ms from page via CDP
4. **Storage**: Events saved to `DATA_DIR` (default: `/tmp/browserless-recordings`)

### Recording Flow for External Clients

```
1. Client connects: ws://browserless:3000?replay=true&trackingId=xxx
2. Browser launched, session created
3. Recording WebSocket opened to browser CDP endpoint
4. Target.setDiscoverTargets enabled (listens for new pages)
5. On targetCreated: attach with flatten=false, inject rrweb
6. Poll events via Target.sendMessageToTarget → Runtime.evaluate
7. On session close: save recording, return via /recordings API
```

### Key Files

- `src/session-replay.ts` - Recording storage and retrieval
- `src/browsers/index.ts` - `setupRecordingForAllTabs()` method
- `src/generated/rrweb-script.ts` - Bundled rrweb recording script
- `src/generated/rrweb-player.ts` - Bundled rrweb player for viewing
- `src/routes/management/http/recording*.ts` - REST API for recordings
