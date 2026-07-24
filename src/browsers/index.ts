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
  makeDevtoolsFrontendURL,
  makeExternalURL,
  makeExternalWebSocketURL,
  noop,
  parseBooleanParam,
  parseStringParam,
  pwVersionRegex,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import { deleteAsync } from 'del';
import micromatch from 'micromatch';
import path from 'path';

// Chrome releases its profile-dir file handles within a few hundred ms
// of `browser.close()` resolving, so 200/400/800 ms covers the realistic
// EBUSY/ENOTEMPTY window.
const REMOVE_RETRY_BACKOFF_MS = [200, 400, 800];

export class BrowserManager {
  protected reconnectionPatterns = ['/devtools/browser', '/function/connect'];
  protected browsers: Map<BrowserInstance, BrowserlessSession> = new Map();
  protected timers: Map<string, NodeJS.Timeout> = new Map();
  // /json/version and /json/protocol are invariant for the life of the
  // installed binary — cache them so we don't boot a whole Chromium per
  // metadata request.
  protected protocolJSONCache: object | null = null;
  protected versionJSONCache: Omit<
    CDPJSONPayload,
    'webSocketDebuggerUrl'
  > | null = null;
  protected log = new Logger('browser-manager');
  protected chromeBrowsers = [ChromiumCDP, ChromeCDP, EdgeCDP];
  protected playwrightBrowserNames = [
    ChromiumPlaywright.name,
    ChromePlaywright.name,
    EdgePlaywright.name,
    FirefoxPlaywright.name,
    WebKitPlaywright.name,
  ];

  // user-data-dirs whose deletion exhausted its retries; retried on an
  // interval so a transient handle-hold doesn't permanently leak disk.
  protected orphanedDataDirs: Set<string> = new Set();
  protected orphanedDataDirSweeper: NodeJS.Timeout;

  constructor(
    protected config: Config,
    protected hooks: Hooks,
    protected fileSystem: FileSystem,
  ) {
    this.orphanedDataDirSweeper = setInterval(
      () => this.sweepOrphanedDataDirs(),
      5 * 60 * 1000,
    );
    // Don't hold the process open for the sweeper
    this.orphanedDataDirSweeper.unref?.();
  }

  protected browserIsChrome(b: BrowserInstance) {
    return this.chromeBrowsers.some(
      (chromeBrowser) => b instanceof chromeBrowser,
    );
  }

  protected async sweepOrphanedDataDirs(): Promise<void> {
    for (const dir of this.orphanedDataDirs) {
      if (!(await exists(dir))) {
        this.orphanedDataDirs.delete(dir);
        continue;
      }
      try {
        await deleteAsync(dir, { force: true });
        this.orphanedDataDirs.delete(dir);
        this.log.info(`Reclaimed previously-orphaned user-data-dir "${dir}"`);
      } catch (err) {
        this.log.debug(
          `Orphaned user-data-dir "${dir}" still undeletable: ${err}`,
        );
      }
    }
  }

  /**
   * Fetches JSON from a local browser's HTTP endpoint with a hard timeout
   * so a wedged Chrome can't stall management APIs; returns null on any
   * failure (browser died, non-200, malformed JSON).
   */
  protected async fetchBrowserJSON<T>(url: string): Promise<T | null> {
    try {
      const response = await fetch(url, {
        headers: { Host: '127.0.0.1' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as T;
    } catch {
      return null;
    }
  }

  protected async removeUserDataDir(userDataDir: string | null) {
    if (!userDataDir || !(await exists(userDataDir))) return;
    this.log.debug(`Deleting data directory "${userDataDir}"`);

    // Retry with backoff to absorb the transient EBUSY/ENOTEMPTY window
    // that `del` sometimes hits while Chrome is still releasing handles
    // on the profile directory. Without retries this manifests as a
    // single logged error and a leaked dir.
    const totalAttempts = REMOVE_RETRY_BACKOFF_MS.length + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        await deleteAsync(userDataDir, { force: true });
        return;
      } catch (err) {
        if (attempt === totalAttempts - 1) {
          this.log.error(
            `Failed to remove user-data-dir "${userDataDir}" after ${totalAttempts} attempts: ${err}; queueing for background retry`,
          );
          this.orphanedDataDirs.add(userDataDir);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, REMOVE_RETRY_BACKOFF_MS[attempt]),
        );
      }
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
    if (this.protocolJSONCache) {
      return this.protocolJSONCache;
    }
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

    // The finally guarantees the throwaway browser dies even when the
    // fetch or JSON parse throws — otherwise every failed request here
    // leaked a Chrome process.
    try {
      await browser.launch({ options: {} });
      const wsEndpoint = browser.wsEndpoint();

      if (!wsEndpoint) {
        throw new Error('There was an error launching the browser');
      }

      const { port } = new URL(wsEndpoint);
      const protocolJSON = await this.fetchBrowserJSON<object>(
        `http://127.0.0.1:${port}/json/protocol`,
      );
      if (!protocolJSON) {
        throw new Error(
          'There was an error fetching /json/protocol from the browser',
        );
      }

      this.protocolJSONCache = protocolJSON;
      return protocolJSON;
    } finally {
      browser.close().catch(noop);
    }
  }

  /**
   * Returns the /json/version API from Chromium or Chrome, whichever is installed,
   * and modifies URLs to set them to the appropriate addresses configured.
   * When both Chrome and Chromium are installed, defaults to Chromium.
   */
  public async getVersionJSON(logger: Logger): Promise<CDPJSONPayload> {
    // The external address can change at runtime, so only the static
    // browser metadata is cached; webSocketDebuggerUrl is recomputed.
    if (this.versionJSONCache) {
      return {
        ...this.versionJSONCache,
        webSocketDebuggerUrl: this.config.getExternalWebSocketAddress(),
      } as CDPJSONPayload;
    }

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

    // The finally guarantees the throwaway browser dies even when the
    // fetch or JSON parse throws — otherwise every failed request here
    // leaked a Chrome process.
    let meta;
    try {
      await browser.launch({ options: {} });
      const wsEndpoint = browser.wsEndpoint();

      if (!wsEndpoint) {
        throw new ServerError('There was an error launching the browser');
      }

      const { port } = new URL(wsEndpoint);
      meta = await this.fetchBrowserJSON<Record<string, string>>(
        `http://127.0.0.1:${port}/json/version`,
      );
    } finally {
      browser.close().catch(noop);
    }

    if (!meta) {
      throw new ServerError(
        'There was an error fetching /json/version from the browser',
      );
    }

    const { 'WebKit-Version': webkitVersion } = meta;
    // Some builds format WebKit-Version without an embedded hash — degrade
    // to an empty Debugger-Version rather than throwing on [1] of null.
    const debuggerVersion =
      webkitVersion?.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)?.[1] ?? '';

    this.versionJSONCache = {
      ...meta,
      'Debugger-Version': debuggerVersion,
    } as unknown as Omit<CDPJSONPayload, 'webSocketDebuggerUrl'>;

    return {
      ...meta,
      'Debugger-Version': debuggerVersion,
      webSocketDebuggerUrl: this.config.getExternalWebSocketAddress(),
    } as unknown as CDPJSONPayload;
  }

  /**
   * Returns a list of all Chrome-like browsers (both Chromium and Chrome) with
   * their respective /json/list contents. URLs are modified so that subsequent
   * calls can be forwarded to the appropriate destination
   */
  public async getJSONList(
    token?: string | null,
  ): Promise<Array<CDPJSONPayload>> {
    const externalAddress = this.config.getExternalWebSocketAddress();
    const externalHTTPAddress = this.config.getExternalAddress();
    const sessions = Array.from(this.browsers);

    const cdpResponse = await Promise.all(
      sessions.map(async ([browser]) => {
        const isChromeLike = this.browserIsChrome(browser);
        const wsEndpoint = browser.wsEndpoint();
        if (isChromeLike && wsEndpoint) {
          const port = new URL(wsEndpoint).port;
          const cdpJSON = await this.fetchBrowserJSON<Array<CDPJSONPayload>>(
            `http://127.0.0.1:${port}/json/list`,
          );
          if (cdpJSON) {
            return cdpJSON.map((c) => {
              const internalWebSocketURL = new URL(c.webSocketDebuggerUrl);
              const webSocketDebuggerURL = makeExternalWebSocketURL(
                externalAddress,
                internalWebSocketURL.pathname,
              );
              const authorizedWebSocketURL = makeExternalWebSocketURL(
                externalAddress,
                internalWebSocketURL.pathname,
                token,
              );
              const internalDevtoolsFrontendURL = new URL(
                c.devtoolsFrontendUrl,
                externalHTTPAddress,
              );
              const devtoolsFrontendURL = new URL(externalHTTPAddress);
              devtoolsFrontendURL.pathname = path.posix.join(
                devtoolsFrontendURL.pathname,
                '/devtools/inspector.html',
              );
              const hasWebSocketTarget =
                internalDevtoolsFrontendURL.searchParams.has('ws') ||
                internalDevtoolsFrontendURL.searchParams.has('wss');
              const externalDevtoolsFrontendURL = hasWebSocketTarget
                ? makeDevtoolsFrontendURL(
                    devtoolsFrontendURL,
                    authorizedWebSocketURL,
                  )
                : devtoolsFrontendURL;

              return {
                ...c,
                devtoolsFrontendUrl: externalDevtoolsFrontendURL.href,
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
    token?: string | null,
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

    if (this.browserIsChrome(browser) && internalWSEndpoint) {
      const browserURI = new URL(internalWSEndpoint);
      const body = await this.fetchBrowserJSON<Array<CDPJSONPayload>>(
        `http://127.0.0.1:${browserURI.port}/json/list`,
      );
      if (body) {
        for (const page of body) {
          const pageURI = new URL(page.webSocketDebuggerUrl);
          const webSocketURL = makeExternalWebSocketURL(
            serverWSAddress,
            pageURI.pathname,
          );
          const authorizedWebSocketURL = makeExternalWebSocketURL(
            serverWSAddress,
            pageURI.pathname,
            token,
          );
          const frontendURL = new URL(serverHTTPAddress);
          frontendURL.pathname = path.posix.join(
            frontendURL.pathname,
            '/devtools/inspector.html',
          );
          const externalDevtoolsFrontendURL = makeDevtoolsFrontendURL(
            frontendURL,
            authorizedWebSocketURL,
          );
          const devtoolsFrontendUrl =
            externalDevtoolsFrontendURL.pathname +
            externalDevtoolsFrontendURL.search;

          // /devtools/browser/b733c56b-8543-489c-b27b-28e12d966c01
          const browserWSEndpoint = makeExternalWebSocketURL(
            serverWSAddress,
            browserURI.pathname,
          ).href;

          // /devtools/page/802B1FDAD5F75E9BCE92D066DFF13253
          const webSocketDebuggerUrl = webSocketURL.href;

          sessions.push({
            ...sessions[0],
            ...page,
            browserWSEndpoint,
            devtoolsFrontendUrl,
            webSocketDebuggerUrl,
          } as unknown as (typeof sessions)[number]);
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
      this.timers.delete(session.id);
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
            this.close(browser, session).catch((err) =>
              this.log.error(
                `Error closing session "${session.id}" from timer: ${err}`,
              ),
            );
          }
        }, timeout),
      );
    }

    if (!keepOpen) {
      this.log.debug(`Closing browser session`);
      // Evict synchronously, before any `await`. Both `killSessions` and
      // `complete` invoke this.close() without awaiting; if eviction ran
      // after the first yield, a `/kill` would return 204 with the
      // session still visible to subsequent `/sessions` and trackingId
      // checks for the duration of browser.close() (hundreds of ms).
      this.browsers.delete(browser);

      // Serialise browser shutdown then data-dir removal: chromium
      // releases its file handles when `browser.close()` resolves, so
      // running `removeUserDataDir` in parallel produced silent EBUSY
      // failures and orphaned profile directories. The `finally` block
      // guarantees data-dir cleanup runs even if `browser.close()`
      // rejects (process already gone, IPC error, etc.).
      try {
        await browser.close();
      } catch (err) {
        this.log.warn(
          `browser.close() rejected for session "${session.id}": ${err}; proceeding with data-dir cleanup`,
        );
      } finally {
        if (session.isTempDataDir) {
          this.log.debug(`Deleting "${session.userDataDir}" user-data-dir`);
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
        this.close(browser, session, true).catch((err) =>
          this.log.error(`Error in killSessions for "${session.id}": ${err}`),
        );
        closed++;
      }
    }
    if (closed === 0 && target !== 'all') {
      throw new NotFound(`Couldn't locate session for id: "${target}"`);
    }
  }

  public async getAllSessions(
    trackingId?: string,
    token?: string | null,
  ): Promise<BrowserlessSessionJSON[]> {
    const sessions = Array.from(this.browsers);

    // Query browsers concurrently and tolerate individual failures — one
    // wedged or mid-shutdown browser shouldn't stall or 500 /sessions.
    let formattedSessions: BrowserlessSessionJSON[] = (
      await Promise.all(
        sessions.map(([browser, session]) =>
          this.generateSessionJson(browser, session, token).catch((err) => {
            this.log.warn(
              `Error generating session JSON for "${session.id}": ${err}`,
            );
            return [];
          }),
        ),
      )
    ).flat();

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

    this.close(browser, session).catch((err) =>
      this.log.error(`Error completing session "${session.id}": ${err}`),
    );
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
              const body = await this.fetchBrowserJSON<Array<CDPJSONPayload>>(
                `http://127.0.0.1:${port}/json/list`,
              );
              return body ? body.map((b) => ({ ...b, browser })) : [];
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

    try {
      await browser.launch({
        options: launchOptions as BrowserServerOptions,
        pwVersion,
        req,
        stealth: launchOptions?.stealth,
      });
      await this.hooks.browser({ browser, req });
    } catch (err) {
      // No BrowserlessSession exists yet at this point, so the normal
      // close path cannot reclaim the auto-generated user-data-dir.
      // Tear down both explicitly before rethrowing. Manual data-dirs
      // (caller-supplied via --user-data-dir or launchOptions.userDataDir)
      // are the caller's lifecycle to manage and stay put.
      await browser
        .close()
        .catch((closeErr) =>
          this.log.debug(
            `browser.close() during launch-failure cleanup also failed: ${closeErr}`,
          ),
        );
      if (!manualUserDataDir && userDataDir) {
        await this.removeUserDataDir(userDataDir);
      }
      throw err;
    }

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

    // A still-present session here means nobody called close() — the
    // underlying process exited on its own (OOM, segfault, SIGKILL).
    // Route through the unified close path so SDK overrides participate.
    browser.once('close', () => {
      const orphaned = this.browsers.get(browser);
      if (!orphaned) return;
      this.log.info(
        `Session "${orphaned.id}" closed unexpectedly, cleaning up`,
      );
      this.close(browser, orphaned, true).catch((err) =>
        this.log.error(
          `Error cleaning up orphaned session "${orphaned.id}": ${err}`,
        ),
      );
    });

    return browser;
  }

  public async shutdown(): Promise<void> {
    this.log.info(`Closing down browser instances`);
    const sessions = Array.from(this.browsers);
    // Route each session through `this.close(..., force=true)` so the
    // unified close path runs: synchronous eviction, serialised browser
    // shutdown then data-dir removal, retries, and the `finally` guard.
    // Errors per-session are logged and do not abort the rest of
    // shutdown — losing one session's cleanup must not block the
    // others or leave the process hanging.
    await Promise.all(
      sessions.map(([browser, session]) =>
        this.close(browser, session, true).catch((err) =>
          this.log.error(
            `Error during shutdown cleanup for session "${session.id}": ${err}`,
          ),
        ),
      ),
    );
    this.timers.forEach((t) => clearTimeout(t));
    clearInterval(this.orphanedDataDirSweeper);
    // Last-chance reclaim of dirs whose deletion failed during sessions
    await this.sweepOrphanedDataDirs();
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
