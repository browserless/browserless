import {
  BLESS_PAGE_IDENTIFIER,
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessSession,
  BrowserlessSessionJSON,
  CDPJSONPayload,
  CDPLaunchOptions,
  ChromeCDP,
  ChromePlaywright,
  ChromiumCDP,
  ChromiumPlaywright,
  Config,
  EdgeCDP,
  EdgePlaywright,
  FileSystem,
  FirefoxPlaywright,
  Hooks,
  Logger,
  NotFound,
  Request,
  ServerError,
  SessionReplay,
  WebKitPlaywright,
  availableBrowsers,
  convertIfBase64,
  exists,
  generateDataDir,
  getFinalPathSegment,
  getCDPClient,
  getRecordingScript,
  makeExternalURL,
  noop,
  parseBooleanParam,
  parseStringParam,
  pwVersionRegex,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import type { CDPSession } from 'playwright-core';
import { deleteAsync } from 'del';
import micromatch from 'micromatch';
import path from 'path';

export class BrowserManager {
  protected reconnectionPatterns = ['/devtools/browser', '/function/connect'];
  protected browsers: Map<BrowserInstance, BrowserlessSession> = new Map();
  protected timers: Map<string, NodeJS.Timeout> = new Map();
  protected log = new Logger('browser-manager');
  protected chromeBrowsers = [ChromiumCDP, ChromeCDP, EdgeCDP];
  protected playwrightBrowserNames = [
    ChromiumPlaywright.name,
    ChromePlaywright.name,
    EdgePlaywright.name,
    FirefoxPlaywright.name,
    WebKitPlaywright.name,
  ];

  constructor(
    protected config: Config,
    protected hooks: Hooks,
    protected fileSystem: FileSystem,
    protected sessionReplay?: SessionReplay,
  ) {}

  protected browserIsChrome(b: BrowserInstance) {
    return this.chromeBrowsers.some(
      (chromeBrowser) => b instanceof chromeBrowser,
    );
  }

  protected async removeUserDataDir(userDataDir: string | null) {
    if (userDataDir && (await exists(userDataDir))) {
      this.log.debug(`Deleting data directory "${userDataDir}"`);
      await deleteAsync(userDataDir, { force: true }).catch((err) => {
        this.log.error(
          `Error cleaning up user-data-dir "${err}" at ${userDataDir}`,
        );
      });
    }
  }

  protected async onNewPage(req: Request, page: Page, session?: BrowserlessSession) {
    // Set up replay recording if enabled for this session
    if (session?.replay && this.sessionReplay?.isEnabled()) {
      await this.setupPageRecording(page, session.id);
    }
    return await this.hooks.page({ meta: req.parsed, page });
  }

  /**
   * Set up RRWeb recording for a page using raw CDP commands.
   * Works with ALL clients: puppeteer, playwright, raw CDP, pydoll, etc.
   *
   * Key insight from Puppeteer issues:
   * - Page.enable MUST be called before Page.addScriptToEvaluateOnNewDocument
   * - sessionattached event catches new tabs/iframes/popups
   * @see https://github.com/puppeteer/puppeteer/issues/10094
   * @see https://github.com/puppeteer/puppeteer/issues/12706
   */
  protected async setupPageRecording(page: Page, sessionId: string): Promise<void> {
    if (!this.sessionReplay) return;

    // Get raw CDP client - works regardless of how page was created
    const cdp = getCDPClient(page);
    if (!cdp) {
      this.log.warn(`No CDP client available for page, skipping recording`);
      return;
    }

    // Get the recording script early so it's available in collectEvents closure
    const script = getRecordingScript(sessionId);

    const collectEvents = async () => {
      try {
        if (page.isClosed()) return;

        // First, check if rrweb is loaded and actively recording
        // This handles cases where:
        // 1. addScriptToEvaluateOnNewDocument didn't fire
        // 2. rrweb loaded but failed to start recording
        const checkResult = await cdp.send('Runtime.evaluate', {
          expression: `JSON.stringify({
            hasRecording: !!window.__browserlessRecording,
            hasRrweb: !!window.rrweb,
            isRecording: typeof window.__browserlessStopRecording === 'function',
            url: window.location.href
          })`,
          returnByValue: true,
        }).catch(() => null);

        let needsInjection = false;
        if (checkResult?.result?.value) {
          try {
            const status = JSON.parse(checkResult.result.value);
            // Inject if we're on a real page AND (recording not set up OR rrweb not actually recording)
            if (status.url && !status.url.startsWith('about:') && !status.isRecording) {
              needsInjection = true;
              this.log.debug(`Recording not active on ${status.url} (hasRecording=${status.hasRecording}, hasRrweb=${status.hasRrweb}, isRecording=${status.isRecording}), injecting...`);
            }
          } catch {
            // ignore
          }
        }

        // Inject rrweb if needed (self-healing for when addScriptToEvaluateOnNewDocument doesn't work)
        if (needsInjection) {
          // Clear any partial state first so the script reinitializes fully
          await cdp.send('Runtime.evaluate', {
            expression: `delete window.__browserlessRecording; delete window.__browserlessStopRecording;`,
            returnByValue: true,
          }).catch(() => {});

          await cdp.send('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          }).catch((e) => {
            this.log.warn(`Failed to inject rrweb: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        // Now collect events
        const result = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const recording = window.__browserlessRecording;
            const debug = {
              hasRecording: !!recording,
              hasRrweb: !!window.rrweb,
              url: window.location.href,
              eventCount: recording?.events?.length || 0
            };
            if (!recording?.events?.length) return JSON.stringify({ events: [], debug });
            const collected = [...recording.events];
            recording.events = [];
            return JSON.stringify({ events: collected, debug });
          })()`,
          returnByValue: true,
        }).catch((e) => {
          this.log.warn(`collectEvents CDP error: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        });

        if (result?.result?.value) {
          try {
            const parsed = JSON.parse(result.result.value);
            const { events, debug } = parsed;

            // Log debug info periodically (every 10 polls or when events found)
            if (events?.length || Math.random() < 0.1) {
              this.log.debug(`collectEvents: url=${debug?.url}, hasRecording=${debug?.hasRecording}, hasRrweb=${debug?.hasRrweb}, eventCount=${events?.length || 0}`);
            }

            if (events?.length) {
              this.sessionReplay?.addEvents(sessionId, events);
            }
          } catch {
            // JSON parse error, ignore
          }
        }
      } catch {
        // Page closed or navigating
      }
    };

    try {
      // 1. Enable Page domain FIRST (REQUIRED by CDP protocol!)
      // Without this, addScriptToEvaluateOnNewDocument may silently fail
      await cdp.send('Page.enable');

      // 2. Inject for ALL future navigations via raw CDP
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: script,
        runImmediately: true,
      });

      // 3. Handle new tabs/iframes/popups via sessionattached event
      // This catches contexts created after the initial page
      // Note: Using EventEmitter pattern since CDPSession extends it
      const emitter = cdp as unknown as NodeJS.EventEmitter;
      emitter.on('sessionattached', async (attachedSession: CDPSession) => {
        try {
          await attachedSession.send('Page.enable');
          await attachedSession.send('Page.addScriptToEvaluateOnNewDocument', {
            source: script,
            runImmediately: true,
          });
          this.log.debug(`rrweb injection: attached session for ${sessionId}`);
        } catch (e) {
          this.log.warn(`rrweb session attach failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      // 4. Inject immediately on current page via raw CDP Runtime.evaluate
      let initStatus = 'success';
      try {
        await cdp.send('Runtime.evaluate', {
          expression: script,
          returnByValue: true,
        });
      } catch (e) {
        initStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      this.log.debug(`rrweb injection: ${initStatus}`);

      // 5. FIX: Collect events BEFORE navigation starts (prevents event loss)
      // Page.frameStartedLoading fires when navigation begins, BEFORE old document unloads
      emitter.on('Page.frameStartedLoading', async () => {
        try {
          await collectEvents();
          this.log.debug(`Collected events before navigation for session ${sessionId}`);
        } catch {
          // Page might be in weird state during navigation
        }
      });

      // 6. FIX: Re-inject immediately after navigation completes
      // This handles CDP session isolation - addScriptToEvaluateOnNewDocument may not fire
      // for navigations triggered by other CDP sessions (like pydoll)
      const injectAfterNavigation = async (source: string) => {
        // Small delay to let the page initialize
        await new Promise((r) => setTimeout(r, 50));
        try {
          if (page.isClosed()) return;
          await cdp.send('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          });
          this.log.debug(`Re-injected rrweb (${source}) for session ${sessionId}`);
        } catch {
          // Page might not be ready yet, self-healing will catch it
        }
      };

      // Listen for multiple navigation events for redundancy
      emitter.on('Page.frameNavigated', () => injectAfterNavigation('frameNavigated'));
      emitter.on('Page.loadEventFired', () => injectAfterNavigation('loadEventFired'));
      emitter.on('Page.domContentEventFired', () => injectAfterNavigation('domContentEventFired'));

      // 7. FIX: Collect events more frequently (200ms instead of 1000ms)
      // Reduces maximum event loss window from 1 second to 200ms
      const intervalId = setInterval(collectEvents, 200);

      // 8. Register final collector so we don't lose events on session close
      // This is called by stopRecording BEFORE setting isRecording=false
      this.sessionReplay?.registerFinalCollector(sessionId, collectEvents);

      page.once('close', async () => {
        clearInterval(intervalId);
        // Note: collectEvents here might be redundant now, but kept for safety
        await collectEvents();
      });

      this.log.debug(`Recording enabled for session ${sessionId}`);
    } catch (err) {
      this.log.warn(`Failed to set up replay recording: ${err}`);
    }
  }

  /**
   * Set up recording for ALL tabs - both existing and future ones.
   * This handles CDP clients like pydoll that use get_opened_tabs()[0].
   *
   * Why this is needed:
   * - Browserless's newPage event only fires for pages created through its wrapper
   * - CDP clients like pydoll connect directly and use existing tabs
   * - We need to inject recording at the CDP level to catch all pages
   */
  protected async setupRecordingForAllTabs(
    browser: BrowserInstance,
    sessionId: string,
  ): Promise<void> {
    if (!this.sessionReplay) return;

    const wsEndpoint = browser.wsEndpoint();
    if (!wsEndpoint) return;

    try {
      // Connect puppeteer to the BROWSER's wsEndpoint
      const puppeteer = await import('puppeteer-core');
      const pptr = await puppeteer.default.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null,
        // Short timeout for CDP operations - recording setup shouldn't block session creation
        // Default is 180s which causes the entire getBrowserForRequest to block
        protocolTimeout: 10000, // 10 seconds max for any CDP command
      });

      // Track pages we've already set up recording for (avoid duplicates)
      // Use WeakSet to track actual Page objects - more reliable than URLs
      const recordingSetUp = new WeakSet<Page>();

      const setupRecordingForPage = async (page: Page, source: string) => {
        if (recordingSetUp.has(page)) return;
        recordingSetUp.add(page);

        try {
          await this.setupPageRecording(page, sessionId);
          this.log.debug(`Set up recording for ${source} tab, session ${sessionId}`);
        } catch (e) {
          this.log.debug(
            `Failed to setup recording for ${source} tab: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      };

      // FIRST: Set up listener for new/in-flight targets BEFORE getting existing pages
      // This prevents race conditions where a tab is created between pages() and listener setup
      pptr.on('targetcreated', async (target) => {
        if (target.type() !== 'page') return;
        try {
          const page = await target.page();
          if (page) await setupRecordingForPage(page, 'new');
        } catch (e) {
          this.log.warn(`Failed to get page from target: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      // Wait for at least one page to exist (handles waitForInitialPage: false)
      // The browser might not have created its initial page yet
      let pages = await pptr.pages();
      if (pages.length === 0) {
        this.log.debug(`No pages yet, waiting for initial page...`);
        const startTime = Date.now();
        const timeout = 5000; // 5 second max wait
        while (pages.length === 0 && Date.now() - startTime < timeout) {
          await new Promise((r) => setTimeout(r, 50));
          pages = await pptr.pages();
        }
        if (pages.length === 0) {
          this.log.warn(`No pages found after ${timeout}ms, recording may not work`);
        }
      }

      // Set up recording for pages that exist
      for (const page of pages) {
        await setupRecordingForPage(page, 'existing');
      }

      // Register cleanup to disconnect puppeteer when recording stops
      this.sessionReplay?.registerCleanupFn(sessionId, async () => {
        try {
          pptr.disconnect();
          this.log.debug(`Disconnected puppeteer for session ${sessionId}`);
        } catch (e) {
          this.log.warn(`Failed to disconnect puppeteer: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      this.log.debug(`Recording active for ${pages.length} tab(s), session ${sessionId}`);
    } catch (e) {
      this.log.debug(
        `Failed to setup recording for tabs: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Returns the /json/protocol API contents from Chromium or Chrome, whichever is installed,
   * and modifies URLs to set them to the appropriate addresses configured.
   * When both Chrome and Chromium are installed, defaults to Chromium.
   */
  public async getProtocolJSON(logger: Logger): Promise<object> {
    const Browser = (await availableBrowsers).find((InstalledBrowser) =>
      this.chromeBrowsers.some(
        (ChromeBrowser) => InstalledBrowser === ChromeBrowser,
      ),
    );
    if (!Browser) {
      throw new Error(`No Chrome or Chromium browsers are installed!`);
    }
    const browser = new Browser({
      blockAds: false,
      config: this.config,
      logger,
      userDataDir: null,
    });
    await browser.launch({ options: {} });
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new Error('There was an error launching the browser');
    }

    const { port } = new URL(wsEndpoint);
    const res = await fetch(`http://127.0.0.1:${port}/json/protocol`);
    const protocolJSON = await res.json();

    browser.close();

    return protocolJSON;
  }

  /**
   * Returns the /json/version API from Chromium or Chrome, whichever is installed,
   * and modifies URLs to set them to the appropriate addresses configured.
   * When both Chrome and Chromium are installed, defaults to Chromium.
   */
  public async getVersionJSON(logger: Logger): Promise<CDPJSONPayload> {
    this.log.debug(`Launching Chromium to generate /json/version results`);
    const Browser = (await availableBrowsers).find((InstalledBrowser) =>
      this.chromeBrowsers.some(
        (ChromeBrowser) => InstalledBrowser === ChromeBrowser,
      ),
    );

    if (!Browser) {
      throw new ServerError(`No Chrome or Chromium browsers are installed!`);
    }
    const browser = new Browser({
      blockAds: false,
      config: this.config,
      logger,
      userDataDir: null,
    });
    await browser.launch({ options: {} });
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new ServerError('There was an error launching the browser');
    }

    const { port } = new URL(wsEndpoint);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const meta = await res.json();

    browser.close();

    const { 'WebKit-Version': webkitVersion } = meta;
    const debuggerVersion = webkitVersion.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)[1];

    return {
      ...meta,
      'Debugger-Version': debuggerVersion,
      webSocketDebuggerUrl: this.config.getExternalWebSocketAddress(),
    };
  }

  /**
   * Returns a list of all Chrome-like browsers (both Chromium and Chrome) with
   * their respective /json/list contents. URLs are modified so that subsequent
   * calls can be forwarded to the appropriate destination
   */
  public async getJSONList(): Promise<Array<CDPJSONPayload>> {
    const externalAddress = this.config.getExternalWebSocketAddress();
    const externalURL = new URL(externalAddress);
    const sessions = Array.from(this.browsers);

    const cdpResponse = await Promise.all(
      sessions.map(async ([browser]) => {
        const isChromeLike = this.browserIsChrome(browser);
        const wsEndpoint = browser.wsEndpoint();
        if (isChromeLike && wsEndpoint) {
          const port = new URL(wsEndpoint).port;
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
            headers: {
              Host: '127.0.0.1',
            },
          });
          if (response.ok) {
            const cdpJSON: Array<CDPJSONPayload> = await response.json();
            return cdpJSON.map((c) => {
              const webSocketDebuggerURL = new URL(c.webSocketDebuggerUrl);
              const devtoolsFrontendURL = new URL(
                c.devtoolsFrontendUrl,
                externalAddress,
              );
              const wsQuery = devtoolsFrontendURL.searchParams.get('ws');

              if (wsQuery) {
                const paramName = externalURL.protocol.startsWith('wss')
                  ? 'wss'
                  : 'ws';
                devtoolsFrontendURL.searchParams.set(
                  paramName,
                  path.join(
                    webSocketDebuggerURL.host,
                    webSocketDebuggerURL.pathname,
                  ),
                );
              }

              webSocketDebuggerURL.host = externalURL.host;
              webSocketDebuggerURL.port = externalURL.port;
              webSocketDebuggerURL.protocol = externalURL.protocol;

              return {
                ...c,
                devtoolsFrontendUrl: devtoolsFrontendURL.href,
                webSocketDebuggerUrl: webSocketDebuggerURL.href,
              };
            });
          }
        }
        return null;
      }),
    );

    return cdpResponse
      .flat()
      .filter((_) => _ !== null) as Array<CDPJSONPayload>;
  }

  protected async generateSessionJson(
    browser: BrowserInstance,
    session: BrowserlessSession,
  ) {
    const serverHTTPAddress = this.config.getExternalAddress();
    const serverWSAddress = this.config.getExternalWebSocketAddress();

    const sessions = [
      {
        ...session,
        browser: browser.constructor.name,
        browserId: session.id,
        initialConnectURL: new URL(session.initialConnectURL, serverHTTPAddress)
          .href,
        killURL: session.id
          ? makeExternalURL(serverHTTPAddress, '/kill/', session.id)
          : null,
        running: browser.isRunning(),
        timeAliveMs: Date.now() - session.startedOn,
        type: 'browser',
      },
    ];

    const internalWSEndpoint = browser.wsEndpoint();
    const externalURI = new URL(serverHTTPAddress);
    const externalProtocol = externalURI.protocol === 'https:' ? 'wss' : 'ws';

    if (this.browserIsChrome(browser) && internalWSEndpoint) {
      const browserURI = new URL(internalWSEndpoint);
      const response = await fetch(
        `http://127.0.0.1:${browserURI.port}/json/list`,
        {
          headers: {
            Host: '127.0.0.1',
          },
        },
      );
      if (response.ok) {
        const body = await response.json();
        for (const page of body) {
          const pageURI = new URL(page.webSocketDebuggerUrl);
          const devtoolsFrontendUrl =
            `/devtools/inspector.html?${externalProtocol}=${externalURI.host}${externalURI.pathname}${pageURI.pathname}`.replace(
              /\/\//gi,
              '/',
            );

          // /devtools/browser/b733c56b-8543-489c-b27b-28e12d966c01
          const browserWSEndpoint = new URL(
            browserURI.pathname,
            serverWSAddress,
          ).href;

          // /devtools/page/802B1FDAD5F75E9BCE92D066DFF13253
          const webSocketDebuggerUrl = new URL(
            pageURI.pathname,
            serverWSAddress,
          ).href;

          sessions.push({
            ...sessions[0],
            ...page,
            browserWSEndpoint,
            devtoolsFrontendUrl,
            webSocketDebuggerUrl,
          });
        }
      }
    }
    return sessions;
  }

  public async close(
    browser: BrowserInstance,
    session: BrowserlessSession,
    force = false,
  ): Promise<void> {
    const now = Date.now();
    const keepUntil = browser.keepUntil();
    const connected = session.numbConnected;
    const hasKeepUntil = keepUntil > now;
    const keepOpen = (connected > 0 || hasKeepUntil) && !force;
    const cleanupACtions: Array<() => Promise<void>> = [];
    const priorTimer = this.timers.get(session.id);

    if (priorTimer) {
      this.log.debug(`Deleting prior keep-until timer for "${session.id}"`);
      global.clearTimeout(priorTimer);
    }

    this.log.debug(
      `${session.numbConnected} Client(s) are currently connected, Keep-until: ${keepUntil}, force: ${force}`,
    );

    if (!force && hasKeepUntil) {
      const timeout = keepUntil - now;
      this.log.trace(
        `Setting timer ${timeout.toLocaleString()} for "${session.id}"`,
      );
      this.timers.set(
        session.id,
        global.setTimeout(() => {
          const session = this.browsers.get(browser);
          if (session) {
            this.log.trace(`Timer hit for "${session.id}"`);
            this.close(browser, session);
          }
        }, timeout),
      );
    }

    if (!keepOpen) {
      this.log.debug(`Closing browser session`);

      // Stop recording and save if replay was enabled
      if (session.replay && this.sessionReplay) {
        await this.sessionReplay.stopRecording(session.id, {
          browserType: browser.constructor.name,
          routePath: Array.isArray(session.routePath)
            ? session.routePath[0]
            : session.routePath,
          trackingId: session.trackingId,
        });
      }

      cleanupACtions.push(() => browser.close());

      // Always delete session from memory
      this.browsers.delete(browser);

      // Only delete temp user data directories
      if (session.isTempDataDir) {
        this.log.debug(
          `Deleting "${session.userDataDir}" temp user-data-dir`,
        );
        cleanupACtions.push(() => this.removeUserDataDir(session.userDataDir));
      }

      await Promise.all(cleanupACtions.map((a) => a()));
    }
  }

  public async killSessions(target: string): Promise<void> {
    this.log.debug(`killSessions invoked target: "${target}"`);
    const sessions = Array.from(this.browsers);
    let closed = 0;
    for (const [browser, session] of sessions) {
      if (
        session.trackingId === target ||
        session.id === target ||
        target === 'all'
      ) {
        this.log.debug(
          `Closing browser via killSessions BrowserId: "${session.id}", trackingId: "${session.trackingId}"`,
        );
        // CRITICAL: Must await close() to ensure session is fully cleaned up before
        // returning from kill API. Without await, the /kill endpoint returns 204 while
        // close() runs in background, causing a race condition where:
        // 1. Kill API returns success immediately
        // 2. close() starts async cleanup
        // 3. Another request may see the session as still active
        // 4. Session records accumulate in this.browsers Map → memory leak → OOM crash
        // See: https://github.com/browserless/browserless/issues/XXX
        await this.close(browser, session, true);
        closed++;
      }
    }
    if (closed === 0 && target !== 'all') {
      throw new NotFound(`Couldn't locate session for id: "${target}"`);
    }
  }

  public async getAllSessions(
    trackingId?: string,
  ): Promise<BrowserlessSessionJSON[]> {
    const sessions = Array.from(this.browsers);

    let formattedSessions: BrowserlessSessionJSON[] = [];
    for (const [browser, session] of sessions) {
      const formattedSession = await this.generateSessionJson(browser, session);
      formattedSessions.push(...formattedSession);
    }

    if (trackingId) {
      formattedSessions = formattedSessions.filter(
        (s) => s.trackingId && s.trackingId === trackingId,
      );
    }

    return formattedSessions;
  }

  public async complete(browser: BrowserInstance): Promise<void> {
    const session = this.browsers.get(browser);
    if (!session) {
      this.log.debug(
        `Couldn't locate session for browser, proceeding with close`,
      );
      return browser.close();
    }

    const { id, resolver } = session;

    if (id && resolver) {
      resolver(null);
    }

    --session.numbConnected;

    // CRITICAL: Must await close() to ensure session is removed from this.browsers
    // before returning. This method is called when a WebSocket client disconnects.
    // Without await, the method returns while close() runs in background, causing:
    // 1. complete() returns immediately to the socket close handler
    // 2. close() starts async cleanup including this.browsers.delete()
    // 3. If another operation queries sessions before delete completes, it sees stale data
    // 4. Over time, sessions accumulate in memory → eventual OOM crash
    // The close() method performs cleanup in order: browser.close() → delete from Map
    // → remove temp directories. All must complete before we consider the session closed.
    await this.close(browser, session);
  }

  public async getBrowserForRequest(
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
    logger: Logger,
  ): Promise<BrowserInstance> {
    const { browser: Browser } = router;
    const blockAds = parseBooleanParam(
      req.parsed.searchParams,
      'blockAds',
      false,
    );
    const replay = parseBooleanParam(
      req.parsed.searchParams,
      'replay',
      false,
    );
    const trackingId =
      parseStringParam(req.parsed.searchParams, 'trackingId', '') || undefined;

    // Handle trackingId
    if (trackingId) {
      this.browsers.forEach((b) => {
        if (b.trackingId === trackingId) {
          throw new BadRequest(
            `A browser session with trackingId "${trackingId}" already exists`,
          );
        }
      });

      if (trackingId.length > 32) {
        throw new BadRequest(
          `TrackingId "${trackingId}" must be less than 32 characters`,
        );
      }

      if (!micromatch.isMatch(trackingId, '+([0-9a-zA-Z-_])')) {
        throw new BadRequest(`trackingId contains invalid characters`);
      }

      if (trackingId === 'all') {
        throw new BadRequest(`trackingId cannot be the reserved word "all"`);
      }

      this.log.debug(`Assigning session trackingId "${trackingId}"`);
    }

    const decodedLaunchOptions = convertIfBase64(
      req.parsed.searchParams.get('launch') || '{}',
    );
    let parsedLaunchOptions: BrowserServerOptions | CDPLaunchOptions;

    // Handle browser re-connects here
    if (
      this.reconnectionPatterns.some((p) => req.parsed.pathname.includes(p))
    ) {
      const sessions = Array.from(this.browsers);
      const id = getFinalPathSegment(req.parsed.pathname);
      if (!id) {
        throw new NotFound(
          `Couldn't locate browser ID from path "${req.parsed.pathname}"`,
        );
      }
      const found = sessions.find(([b]) => b.wsEndpoint()?.includes(id));

      if (found) {
        const [browser, session] = found;
        ++session.numbConnected;
        this.log.debug(`Located browser with ID ${id}`);
        return browser;
      }

      throw new NotFound(
        `Couldn't locate browser "${id}" for request "${req.parsed.pathname}"`,
      );
    }

    // Handle page connections here
    if (req.parsed.pathname.includes('/devtools/page')) {
      const id = getFinalPathSegment(req.parsed.pathname);
      if (!id?.includes(BLESS_PAGE_IDENTIFIER)) {
        const browsers = Array.from(this.browsers).map(([browser]) => browser);
        const allPages = await Promise.all(
          browsers
            .filter((b) => !!b.wsEndpoint())
            .map(async (browser) => {
              const { port } = new URL(
                browser.wsEndpoint() as unknown as string,
              );
              const response = await fetch(
                `http://127.0.0.1:${port}/json/list`,
                {
                  headers: {
                    Host: '127.0.0.1',
                  },
                },
              ).catch(() => ({
                json: () => Promise.resolve([]),
                ok: false,
              }));
              if (response.ok) {
                const body: Array<CDPJSONPayload> = await response.json();
                return body.map((b) => ({ ...b, browser }));
              }
              return [];
            }),
        );
        const found = allPages.flat().find((b) => b.id === id);

        if (found) {
          const session = this.browsers.get(found.browser)!;
          ++session.numbConnected;
          return found.browser;
        }

        throw new NotFound(
          `Couldn't locate browser "${id}" for request "${req.parsed.pathname}"`,
        );
      }
    }

    try {
      parsedLaunchOptions = JSON.parse(decodedLaunchOptions);
    } catch (err) {
      throw new BadRequest(
        `Error parsing launch-options: ${err}. Launch options must be a JSON or base64-encoded JSON object`,
      );
    }

    const routerOptions =
      typeof router.defaultLaunchOptions === 'function'
        ? router.defaultLaunchOptions(req)
        : router.defaultLaunchOptions;

    const launchOptions = {
      ...routerOptions,
      ...parsedLaunchOptions,
    };
    const proxyServerParam = req.parsed.searchParams.get('--proxy-server');
    if (proxyServerParam) {
      const existingArgs = launchOptions.args || [];
      const filteredArgs = existingArgs.filter(
        (arg) => !arg.includes('--proxy-server='),
      );
      launchOptions.args = [
        ...filteredArgs,
        `--proxy-server=${proxyServerParam}`,
      ];
    }

    const manualUserDataDir =
      launchOptions.args
        ?.find((arg) => arg.includes('--user-data-dir='))
        ?.split('=')[1] || (launchOptions as CDPLaunchOptions).userDataDir;

    if (manualUserDataDir && launchOptions.args) {
      launchOptions.args = launchOptions.args.filter(
        (arg) => !arg.includes('--user-data-dir='),
      );
    }

    // Always specify a user-data-dir since plugins can "inject" their own
    // unless it's playwright which takes care of its own data-dirs
    const userDataDir =
      manualUserDataDir ||
      (!this.playwrightBrowserNames.includes(Browser.name)
        ? await generateDataDir(undefined, this.config)
        : null);

    const proxyServerArg = launchOptions.args?.find((arg) =>
      arg.includes('--proxy-server='),
    );

    /**
     * Handle deprecated launch options
     */
    if (Object.hasOwn(launchOptions, 'ignoreHTTPSErrors')) {
      if (!Object.hasOwn(launchOptions, 'acceptInsecureCerts')) {
        (launchOptions as CDPLaunchOptions).acceptInsecureCerts = (
          launchOptions as CDPLaunchOptions
        ).ignoreHTTPSErrors;
      }
      delete (launchOptions as CDPLaunchOptions).ignoreHTTPSErrors;
    }

    /**
     * If it is a playwright request
     */
    if (
      launchOptions.args &&
      proxyServerArg &&
      req.parsed.pathname.includes('/playwright')
    ) {
      (launchOptions as BrowserServerOptions).proxy = {
        server: proxyServerArg.split('=')[1],
      };
      const argIndex = launchOptions.args.indexOf(proxyServerArg);
      launchOptions.args.splice(argIndex, 1);
    }

    const browser = new Browser({
      blockAds,
      config: this.config,
      logger,
      userDataDir,
    });

    const match = (req.headers['user-agent'] || '').match(pwVersionRegex);
    const pwVersion = match ? match[1] : 'default';

    // Pre-create session object so we can reference it in event handler
    // Session ID will be updated after launch when we know the wsEndpoint
    const session: BrowserlessSession = {
      id: '', // Will be set after launch
      initialConnectURL:
        path.join(req.parsed.pathname, req.parsed.search) || '',
      isTempDataDir: !manualUserDataDir,
      launchOptions,
      numbConnected: 1,
      replay: replay && this.sessionReplay?.isEnabled(),
      resolver: noop,
      routePath: router.path,
      startedOn: Date.now(),
      trackingId,
      ttl: 0,
      userDataDir,
    };

    // CRITICAL: Register newPage handler BEFORE launch so we catch all pages
    // including those created by CDP clients (like pydoll) immediately after connect
    browser.on('newPage', async (page: Page) => {
      await this.onNewPage(req, page, session);
      (router.onNewPage || noop)(req.parsed || '', page);
    });

    await browser.launch({
      options: launchOptions as BrowserServerOptions,
      pwVersion,
      req,
      stealth: launchOptions?.stealth,
    });
    await this.hooks.browser({ browser, req });

    // Now we can get the session ID from the wsEndpoint
    const sessionId = getFinalPathSegment(browser.wsEndpoint()!)!;
    session.id = sessionId;

    // Start replay recording if enabled
    if (session.replay && this.sessionReplay) {
      this.sessionReplay.startRecording(sessionId, trackingId);
      this.log.debug(`Started replay recording for session ${sessionId}`);

      // Set up recording for all tabs (existing + future via /json/new)
      await this.setupRecordingForAllTabs(browser, sessionId);
    }

    // Update logger with session context now that we have tracking ID and session ID
    logger.setSessionContext({
      trackingId,
      sessionId,
    });

    this.browsers.set(browser, session);

    return browser;
  }

  public async shutdown(): Promise<void> {
    this.log.info(`Closing down browser instances`);
    const sessions = Array.from(this.browsers);
    await Promise.all(sessions.map(([b]) => b.close()));
    const timers = Array.from(this.timers);
    await Promise.all(timers.map(([, timer]) => clearInterval(timer)));
    this.timers.forEach((t) => clearTimeout(t));
    this.browsers = new Map();
    this.timers = new Map();
    await this.stop();
    this.log.info(`Shutdown complete`);
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
