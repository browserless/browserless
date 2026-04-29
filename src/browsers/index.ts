import * as fs from 'fs/promises';
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
  WebKitPlaywright,
  availableBrowsers,
  convertIfBase64,
  exists,
  generateDataDir,
  getFinalPathSegment,
  makeExternalURL,
  noop,
  parseBooleanParam,
  parseStringParam,
  pwVersionRegex,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import { deleteAsync } from 'del';
import micromatch from 'micromatch';
import path from 'path';
import { tmpdir } from 'os';

/**
 * How long an `org.chromium.Chromium.*` temp directory must be untouched
 * before the periodic sweep considers it abandoned. Chrome only writes to
 * these dirs while a related subprocess is alive, so a 30-minute idle
 * threshold is well past any realistic active session.
 */
const CHROMIUM_ORPHAN_IDLE_MS = 30 * 60 * 1000;

/**
 * Interval between periodic-sweep runs. Each run drains the
 * `pendingCleanup` retry queue and walks the host /tmp for chromium-internal
 * orphans. 5 minutes balances responsiveness against `readdir`/`stat` cost.
 */
const PERIODIC_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Per-attempt backoff for `removeUserDataDir` retries. Chrome typically
 * releases file handles within a few hundred milliseconds of `browser.close()`,
 * so 200ms / 400ms / 800ms covers the realistic EBUSY window.
 */
const REMOVE_RETRY_BACKOFF_MS = [200, 400, 800];

/**
 * The chromium-internal subprocess orphan sweep (`org.chromium.Chromium.*`
 * dirs in the OS temp directory) walks paths that are NOT
 * browserless-managed and could in principle be created by other
 * Chrome-using workloads sharing the same `os.tmpdir()`. Default off so
 * the SDK is safe to drop into shared environments. Container
 * deployments where /tmp is owned exclusively by browserless can opt in
 * with `CLEANUP_HOST_CHROMIUM_TEMP_DIRS=true`.
 */
const HOST_CHROMIUM_CLEANUP_ENABLED =
  process.env.CLEANUP_HOST_CHROMIUM_TEMP_DIRS === 'true';

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

  /**
   * Data-dirs whose deletion failed transiently and must be retried by the
   * periodic sweep. Populated by `removeUserDataDir` after exhausting its
   * inline retries; drained by `periodicSweep`.
   */
  protected pendingCleanup: Set<string> = new Set();

  /**
   * Handle for the periodic sweep loop, kept so `shutdown` can stop it.
   */
  protected periodicSweepHandle: NodeJS.Timeout | null = null;

  /**
   * Resolves once the startup orphan sweep has completed AND the periodic
   * sweep loop has been (conditionally) armed. Awaited by:
   *   - `shutdown()`, so it cannot race with `initCleanup` re-arming the
   *     sweep handle after we've cleared it.
   *   - `getBrowserForRequest()`, so a new session cannot create a fresh
   *     `browserless-data-dir-*` while the startup sweep is mid-walk —
   *     otherwise the sweep's prefix filter would match (and delete) the
   *     in-flight dir.
   */
  protected initCleanupPromise: Promise<void> | null = null;

  /**
   * Set true at the very start of `shutdown`. Read by `initCleanup` to
   * skip arming the periodic sweep when shutdown happened during startup,
   * and by `getBrowserForRequest` to bail rather than spin up a new
   * session against a manager that's tearing down.
   */
  protected shuttingDown = false;

  constructor(
    protected config: Config,
    protected hooks: Hooks,
    protected fileSystem: FileSystem,
  ) {
    // Track the init promise so shutdown() and request handling can
    // synchronise against it. Failures inside are logged but never
    // thrown — cleanup is best-effort by design.
    this.initCleanupPromise = this.initCleanup();
  }

  protected browserIsChrome(b: BrowserInstance) {
    return this.chromeBrowsers.some(
      (chromeBrowser) => b instanceof chromeBrowser,
    );
  }

  protected async removeUserDataDir(userDataDir: string | null) {
    if (!userDataDir) return;
    if (!(await exists(userDataDir))) {
      // Path has vanished (manual cleanup, tmpfs unmount, deleted by
      // someone else). Drop any stale entry so the periodic sweep
      // doesn't keep retrying it forever.
      this.pendingCleanup.delete(userDataDir);
      return;
    }

    this.log.debug(`Deleting data directory "${userDataDir}"`);

    for (let attempt = 0; attempt < REMOVE_RETRY_BACKOFF_MS.length; attempt++) {
      try {
        await deleteAsync(userDataDir, { force: true });
        this.pendingCleanup.delete(userDataDir);
        return;
      } catch (err) {
        const isLastAttempt =
          attempt === REMOVE_RETRY_BACKOFF_MS.length - 1;
        if (isLastAttempt) {
          this.log.warn(
            `Failed to remove user-data-dir "${userDataDir}" after ${REMOVE_RETRY_BACKOFF_MS.length} attempts (${err}); queued for periodic sweep`,
          );
          this.pendingCleanup.add(userDataDir);
          return;
        }
        await new Promise((resolve) =>
          global.setTimeout(resolve, REMOVE_RETRY_BACKOFF_MS[attempt]),
        );
      }
    }
  }

  /**
   * Run once at construction: sweep prior-run orphans from the configured
   * data-dir, then arm the periodic sweep loop. Catches and logs any
   * failures so a transient FS error never prevents the manager from
   * starting.
   */
  protected async initCleanup(): Promise<void> {
    try {
      await this.sweepOrphanDataDirs();
    } catch (err) {
      this.log.warn(`Startup orphan sweep failed: ${err}`);
    }
    // If shutdown was called while the startup sweep was running, do not
    // arm the periodic sweep — shutdown has already cleared whatever
    // handle was here previously and a new interval would outlive the
    // manager.
    if (this.shuttingDown) {
      this.log.debug(
        'Skipping periodic-sweep arm: shutdown was requested during startup sweep',
      );
      return;
    }
    this.periodicSweepHandle = global.setInterval(() => {
      this.periodicSweep().catch((err) => {
        this.log.warn(`Periodic sweep failed: ${err}`);
      });
    }, PERIODIC_SWEEP_INTERVAL_MS);
  }

  /**
   * Walks the configured `dataDir` and removes any `browserless-data-dir-*`
   * leftovers. Called once at startup, before any new sessions land — every
   * such dir is guaranteed to be from a prior run (this manager has no
   * sessions yet) so no PID check is needed.
   */
  protected async sweepOrphanDataDirs(): Promise<void> {
    const baseDir = await this.config.getDataDir();
    if (!(await exists(baseDir))) return;

    let entries: string[];
    try {
      entries = await fs.readdir(baseDir);
    } catch (err) {
      this.log.warn(`Could not read data-dir "${baseDir}": ${err}`);
      return;
    }

    const orphans = entries.filter((e) =>
      e.startsWith('browserless-data-dir-'),
    );
    if (orphans.length === 0) return;

    this.log.info(
      `Startup sweep: removing ${orphans.length} orphan data-dir(s) from prior run`,
    );
    for (const orphan of orphans) {
      await this.removeUserDataDir(path.join(baseDir, orphan));
    }
  }

  /**
   * Runs every PERIODIC_SWEEP_INTERVAL_MS. Two passes:
   *
   * 1. Drain `pendingCleanup` — paths that failed inline retries earlier.
   *    A previously busy file handle is almost always released by the time
   *    the periodic sweep fires, so this catches the long-tail EBUSY cases.
   *
   * 2. Walk `/tmp` for chromium-internal subprocess orphans
   *    (`org.chromium.Chromium.*`). Chrome creates these via mkdtemp for
   *    its renderer/GPU/network/url_fetcher subprocesses and reaps them on
   *    graceful shutdown — but a parent-process kill (OOM, segfault,
   *    SIGKILL) leaves them behind. We use mtime-only as the liveness
   *    signal: any subprocess actively using the dir would have touched it
   *    within the last few minutes, so 30 min of mtime idleness is a safe
   *    floor.
   */
  protected async periodicSweep(): Promise<void> {
    // Pass 1: retry queue
    for (const dir of Array.from(this.pendingCleanup)) {
      await this.removeUserDataDir(dir);
    }

    // Pass 2: chromium-internal orphans. These live in the OS temp dir
    // because Chrome creates them via mkdtemp, which is hard-wired to
    // os.tmpdir() — independent of our configurable DATA_DIR. Using
    // dirname(getDataDir()) only matches /tmp in the default config and
    // silently misses the orphans whenever DATA_DIR points elsewhere.
    //
    // The OS tmp dir can be shared with other workloads, so this pass
    // is gated behind CLEANUP_HOST_CHROMIUM_TEMP_DIRS=true. Default off
    // — opt in only when the SDK is the sole owner of /tmp (typical
    // single-purpose container deployments).
    if (!HOST_CHROMIUM_CLEANUP_ENABLED) {
      this.log.debug(
        'Skipping host-wide chromium-internal orphan sweep; set CLEANUP_HOST_CHROMIUM_TEMP_DIRS=true to enable',
      );
      return;
    }
    const tmpRoot = tmpdir();
    let entries: string[];
    try {
      entries = await fs.readdir(tmpRoot);
    } catch (err) {
      this.log.debug(`Could not read tmp root "${tmpRoot}": ${err}`);
      return;
    }

    const now = Date.now();
    let removed = 0;
    for (const entry of entries) {
      if (!entry.startsWith('org.chromium.Chromium.')) continue;
      const full = path.join(tmpRoot, entry);

      let mtime: Date;
      try {
        const stat = await fs.stat(full);
        if (!stat.isDirectory()) continue;
        mtime = stat.mtime;
      } catch {
        // Disappeared between readdir and stat — fine, move on.
        continue;
      }

      if (now - mtime.getTime() < CHROMIUM_ORPHAN_IDLE_MS) continue;

      try {
        await deleteAsync(full, { force: true });
        removed++;
      } catch (err) {
        this.log.debug(`Could not remove chromium orphan "${full}": ${err}`);
      }
    }

    if (removed > 0) {
      this.log.info(
        `Periodic sweep removed ${removed} stale chromium-internal orphan(s) from "${tmpRoot}"`,
      );
    }
  }

  protected async onNewPage(req: Request, page: Page) {
    return await this.hooks.page({ meta: req.parsed, page });
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
      // Serialise: await Chrome shutdown FIRST so it releases its file
      // handles, then delete the data-dir. Running these in parallel
      // (the previous behaviour) raced `deleteAsync` against Chrome
      // releasing its FDs and produced silent EBUSY/ENOTEMPTY failures
      // that left orphan profile dirs in `/tmp`.
      //
      // Cleanup runs in `finally` so a `browser.close()` rejection
      // (process already gone, IPC error, etc.) cannot skip the
      // data-dir delete and leak the orphan we were trying to prevent.
      try {
        await browser.close();
      } catch (err) {
        this.log.warn(
          `browser.close() rejected during session close ("${session.id}"): ${err}; proceeding with cleanup`,
        );
      } finally {
        // Evict the session from the registry unconditionally — sessions
        // created with an explicit --user-data-dir (isTempDataDir=false)
        // must still be removed from `this.browsers`, otherwise they
        // leak into `getAllSessions()` and trackingId lookups as stale
        // closed-browser entries.
        this.browsers.delete(browser);

        // Data-dir removal stays guarded: only the dirs WE created
        // (isTempDataDir=true) are ours to delete. A caller-supplied
        // --user-data-dir is the caller's lifecycle to manage.
        if (session.isTempDataDir) {
          this.log.debug(
            `Deleting "${session.userDataDir}" user-data-dir and session from memory`,
          );
          await this.removeUserDataDir(session.userDataDir);
        }
      }
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
        this.close(browser, session, true);
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

    this.close(browser, session);
  }

  public async getBrowserForRequest(
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
    logger: Logger,
  ): Promise<BrowserInstance> {
    // Gate every new session on the startup orphan sweep finishing.
    // Without this, `generateDataDir(...)` below could race the sweep:
    // both paths use the `browserless-data-dir-*` prefix in the same
    // dataDir, and the sweep would happily delete an in-flight new
    // session's directory because it cannot tell prior-run leftovers
    // from concurrently-created ones.
    if (this.initCleanupPromise) {
      await this.initCleanupPromise;
    }
    if (this.shuttingDown) {
      throw new ServerError(
        'BrowserManager is shutting down; cannot accept new sessions',
      );
    }
    const { browser: Browser } = router;
    const blockAds = parseBooleanParam(
      req.parsed.searchParams,
      'blockAds',
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

    const timeout = req.parsed.searchParams.get('timeout');
    const launchOptions = {
      ...routerOptions,
      ...parsedLaunchOptions,
      ...(timeout ? { protocolTimeout: +timeout } : {}),
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

    await browser.launch({
      options: launchOptions as BrowserServerOptions,
      pwVersion,
      req,
      stealth: launchOptions?.stealth,
    });
    await this.hooks.browser({ browser, req });

    const sessionId = getFinalPathSegment(browser.wsEndpoint()!)!;
    const session: BrowserlessSession = {
      id: sessionId,
      initialConnectURL:
        path.join(req.parsed.pathname, req.parsed.search) || '',
      isTempDataDir: !manualUserDataDir,
      launchOptions,
      numbConnected: 1,
      resolver: noop,
      routePath: router.path,
      startedOn: Date.now(),
      trackingId,
      ttl: 0,
      userDataDir,
    };

    // Update logger with session context now that we have tracking ID and session ID
    logger.setSessionContext({
      trackingId,
      sessionId,
    });

    this.browsers.set(browser, session);

    browser.on('newPage', async (page: Page) => {
      await this.onNewPage(req, page);
      (router.onNewPage || noop)(req.parsed || '', page);
    });

    return browser;
  }

  public async shutdown(): Promise<void> {
    this.log.info(`Closing down browser instances`);
    // Set the flag FIRST so `initCleanup` (if still running) sees it and
    // skips the periodic-sweep arm — otherwise the interval could be
    // re-armed after we clear it below and outlive the manager.
    this.shuttingDown = true;
    if (this.initCleanupPromise) {
      // Wait for the startup sweep to finish so it cannot complete and
      // re-arm `periodicSweepHandle` after our `clearInterval` runs.
      await this.initCleanupPromise.catch(() => {
        // Already logged inside initCleanup; nothing else to do here.
      });
    }
    const sessions = Array.from(this.browsers);

    // Capture every temp data-dir BEFORE we close the browsers — `close`
    // would clear the references and we'd lose the paths. Without this,
    // every SIGTERM (deploy, container restart, config change) leaks
    // one orphan data-dir per active session into /tmp.
    const tempDataDirs = sessions
      .filter(([, session]) => session.isTempDataDir)
      .map(([, session]) => session.userDataDir)
      .filter((d): d is string => !!d);

    // Best-effort: a single `b.close()` rejection must not prevent the
    // remaining browsers from closing, the data-dirs from being removed,
    // the timers from being cleared, or `stop()` from running. Use
    // `allSettled` so we always reach the rest of the shutdown sequence.
    const closeResults = await Promise.allSettled(
      sessions.map(([b]) => b.close()),
    );
    for (const result of closeResults) {
      if (result.status === 'rejected') {
        this.log.warn(
          `browser.close() rejected during shutdown: ${result.reason}; continuing with cleanup`,
        );
      }
    }

    // Chrome processes are now terminated (or known-failed); safe to
    // delete their data-dirs. `removeUserDataDir` swallows its own
    // errors internally so this should not reject, but `allSettled` is
    // cheap insurance.
    await Promise.allSettled(
      tempDataDirs.map((dir) => this.removeUserDataDir(dir)),
    );

    // Timer / state cleanup is unconditional — regardless of how the
    // close+delete steps went, the manager must end up in a clean
    // state, with no leaked timers and the periodic sweep stopped.
    this.timers.forEach((t) => clearTimeout(t));
    this.browsers = new Map();
    this.timers = new Map();

    if (this.periodicSweepHandle) {
      global.clearInterval(this.periodicSweepHandle);
      this.periodicSweepHandle = null;
    }

    await this.stop();
    this.log.info(`Shutdown complete`);
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
