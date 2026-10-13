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
  generateScratchDir,
  getFinalPathSegment,
  makeExternalURL,
  noop,
  parseBooleanParam,
  parseStringParam,
  pwVersionRegex,
} from '@browserless.io/browserless';
import si, { Systeminformation } from 'systeminformation';
import { Page } from 'puppeteer-core';
import { cpus } from 'os';
import { deleteAsync } from 'del';
import micromatch from 'micromatch';
import path from 'path';

// Chrome releases its profile-dir file handles within a few hundred ms
// of `browser.close()` resolving, so 200/400/800 ms covers the realistic
// EBUSY/ENOTEMPTY window.
const REMOVE_RETRY_BACKOFF_MS = [200, 400, 800];

// One `si.processes()` call shared across every session in a request,
// not one expensive OS-wide enumeration per concurrent session.
interface ProcessTree {
  byPid: Map<number, Systeminformation.ProcessesProcessData>;
  childrenByParentPid: Map<number, number[]>;
  // Pids with no prior sample - systeminformation reports their lifetime
  // average CPU share (near 0 on a long-uptime host) rather than recent
  // usage, so their cpu reading is unreliable until the next sample.
  coldPids: Set<number>;
}

// Linux/Windows normalize proc.cpu across every core (100% = all cores
// saturated); macOS (and the other `ps`-based platforms) already report it
// per-core like `ps` itself. Only the normalized platforms need scaling.
const PLATFORMS_WITH_ALL_CORE_NORMALIZED_CPU = new Set(['linux', 'win32']);

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
  // getProcessTree() forks `ps` plus a per-process `/proc` read on every
  // call spaced over systeminformation's own 500ms cache window - too
  // short for a /sessions endpoint that may be polled every 1-2s. Cache
  // our own result for a couple of seconds on top of that.
  protected processTreeCache: {
    expiresAt: number;
    tree: ProcessTree | null;
  } | null = null;
  protected readonly processTreeCacheMs = 2000;
  protected processTreeRefreshTimer: NodeJS.Timeout | null = null;
  protected processTreeRefreshPromise: Promise<ProcessTree | null> | null =
    null;
  protected seenPids: Set<number> = new Set();
  protected log = new Logger('browser-manager');
  protected chromeBrowsers = [ChromiumCDP, ChromeCDP, EdgeCDP];
  protected playwrightBrowserNames = [
    ChromiumPlaywright.name,
    ChromePlaywright.name,
    EdgePlaywright.name,
    FirefoxPlaywright.name,
    WebKitPlaywright.name,
  ];

  // Session-owned dirs (user-data and scratch) whose deletion exhausted its
  // retries; retried on an interval so a transient handle-hold doesn't
  // permanently leak disk.
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

  // Coalesces concurrent callers (the refresh timer and an in-flight
  // /sessions request can land at the same time) onto one `si.processes()`
  // call, so a slower, earlier call can't overwrite a newer cached result.
  protected async refreshProcessTree(): Promise<ProcessTree | null> {
    if (this.processTreeRefreshPromise) {
      return this.processTreeRefreshPromise;
    }
    const refresh = this.refreshProcessTreeOnce();
    this.processTreeRefreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.processTreeRefreshPromise === refresh) {
        this.processTreeRefreshPromise = null;
      }
    }
  }

  // Never throws: a failure here shouldn't break /sessions, just leave
  // every session's cpu/memoryBytes as null for this one request.
  protected async refreshProcessTreeOnce(): Promise<ProcessTree | null> {
    try {
      const { list } = await si.processes();
      const byPid = new Map(list.map((p) => [p.pid, p]));
      const childrenByParentPid = new Map<number, number[]>();
      const coldPids = new Set<number>();

      for (const p of list) {
        if (!this.seenPids.has(p.pid)) {
          coldPids.add(p.pid);
        }
        const siblings = childrenByParentPid.get(p.parentPid) ?? [];
        siblings.push(p.pid);
        childrenByParentPid.set(p.parentPid, siblings);
      }
      this.seenPids = new Set(byPid.keys());

      const tree = { byPid, childrenByParentPid, coldPids };
      this.processTreeCache = {
        expiresAt: Date.now() + this.processTreeCacheMs,
        tree,
      };
      return tree;
    } catch (err) {
      this.log.warn(`Error reading process list for session stats: ${err}`);
      this.processTreeCache = {
        expiresAt: Date.now() + this.processTreeCacheMs,
        tree: null,
      };
      return null;
    }
  }

  protected async getProcessTree(): Promise<ProcessTree | null> {
    if (this.processTreeCache && this.processTreeCache.expiresAt > Date.now()) {
      return this.processTreeCache.tree;
    }
    return this.refreshProcessTree();
  }

  // Keeps systeminformation's own per-pid CPU baseline warm while any
  // session is alive, so by the time /sessions is actually polled, a
  // session's processes already have a prior sample to delta against -
  // without this, a pid with no prior sample reads its lifetime-average
  // CPU share (near 0 on a long-uptime host), not its recent usage.
  protected startProcessTreeRefresh(): void {
    if (this.processTreeRefreshTimer) {
      return;
    }
    // Prime immediately - an interval alone leaves the first processTreeCacheMs
    // window with no sample at all (and, since coldPids forces cpu to null
    // on an unseen pid regardless, this doesn't need to be the one that
    // produces a usable reading - it only needs to establish the baseline).
    this.refreshProcessTree();
    this.processTreeRefreshTimer = setInterval(
      () => this.refreshProcessTree(),
      this.processTreeCacheMs,
    );
    this.processTreeRefreshTimer.unref?.();
  }

  protected stopProcessTreeRefresh(): void {
    if (this.processTreeRefreshTimer) {
      clearInterval(this.processTreeRefreshTimer);
      this.processTreeRefreshTimer = null;
    }
  }

  // Sums the root PID and every descendant (renderer/GPU/utility, ...), so
  // a session's true footprint isn't understated to just its main process.
  protected sumProcessTree(
    pid: number,
    tree: ProcessTree,
    numCores: number = cpus().length,
  ): { cpu: number | null; memoryBytes: number } | null {
    if (!tree.byPid.has(pid)) {
      return null;
    }

    let cpu = 0;
    let memoryBytes = 0;
    let hasColdPid = false;
    const stack = [pid];
    const seen = new Set<number>();

    while (stack.length) {
      const current = stack.pop() as number;
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);

      const proc = tree.byPid.get(current);
      if (proc) {
        cpu += proc.cpu;
        memoryBytes += proc.memRss * 1024; // memRss is KB; normalize to bytes.
        hasColdPid = hasColdPid || tree.coldPids.has(current);
      }

      for (const child of tree.childrenByParentPid.get(current) ?? []) {
        if (!seen.has(child)) {
          stack.push(child);
        }
      }
    }

    // A pid with no prior sample reads its lifetime-average CPU share, not
    // its recent usage - report unavailable rather than a misleading number.
    if (hasColdPid) {
      return { cpu: null, memoryBytes };
    }

    // systeminformation's proc.cpu is a percentage of total CPU time across
    // every core (100% = all cores saturated) on Linux/Windows, not ps's
    // per-core convention this API documents (100% = one core saturated);
    // macOS and the other `ps`-based platforms already report it per-core.
    // Scale only the all-core-normalized platforms, so a session pinning
    // one full core on an N-core host reports ~100 there too, without
    // inflating the platforms that already match the per-core convention.
    const scaledCpu = PLATFORMS_WITH_ALL_CORE_NORMALIZED_CPU.has(
      process.platform,
    )
      ? cpu * numCores
      : cpu;

    return { cpu: scaledCpu, memoryBytes };
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
        this.log.info(`Reclaimed previously-orphaned session dir "${dir}"`);
      } catch (err) {
        this.log.debug(
          `Orphaned session dir "${dir}" still undeletable: ${err}`,
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

  /**
   * Remove a session-owned directory, retrying with backoff to absorb the
   * transient EBUSY/ENOTEMPTY window that `del` sometimes hits while Chrome is
   * still releasing handles. Without retries this manifests as a single logged
   * error and a leaked dir. A directory that outlasts every attempt is queued
   * for the background sweep rather than abandoned.
   */
  protected async removeSessionDir(dir: string | null, label: string) {
    if (!dir || !(await exists(dir))) return;
    this.log.debug(`Deleting ${label} "${dir}"`);

    const totalAttempts = REMOVE_RETRY_BACKOFF_MS.length + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      try {
        await deleteAsync(dir, { force: true });
        return;
      } catch (err) {
        if (attempt === totalAttempts - 1) {
          this.log.error(
            `Failed to remove ${label} "${dir}" after ${totalAttempts} attempts: ${err}; queueing for background retry`,
          );
          this.orphanedDataDirs.add(dir);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, REMOVE_RETRY_BACKOFF_MS[attempt]),
        );
      }
    }
  }

  protected async removeUserDataDir(userDataDir: string | null) {
    return this.removeSessionDir(userDataDir, 'user-data-dir');
  }

  protected async removeScratchDir(scratchDir: string | null) {
    return this.removeSessionDir(scratchDir, 'scratch-dir');
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
          const cdpJSON = await this.fetchBrowserJSON<Array<CDPJSONPayload>>(
            `http://127.0.0.1:${port}/json/list`,
          );
          if (cdpJSON) {
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
    processTree: ProcessTree | null,
    numCores: number = cpus().length,
  ) {
    const serverHTTPAddress = this.config.getExternalAddress();
    const serverWSAddress = this.config.getExternalWebSocketAddress();

    const pid = browser.process()?.pid;
    const stats =
      pid && processTree
        ? this.sumProcessTree(pid, processTree, numCores)
        : null;

    const sessions = [
      {
        ...session,
        browser: browser.constructor.name,
        browserId: session.id,
        cpu: stats?.cpu ?? null,
        initialConnectURL: new URL(session.initialConnectURL, serverHTTPAddress)
          .href,
        killURL: session.id
          ? makeExternalURL(serverHTTPAddress, '/kill/', session.id)
          : null,
        memoryBytes: stats?.memoryBytes ?? null,
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
      const body = await this.fetchBrowserJSON<Array<CDPJSONPayload>>(
        `http://127.0.0.1:${browserURI.port}/json/list`,
      );
      if (body) {
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
            // Only the browser-level process tree is tracked — drop the
            // spread-inherited numbers so pages don't look like separate readings.
            cpu: undefined,
            devtoolsFrontendUrl,
            memoryBytes: undefined,
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
      if (this.browsers.size === 0) {
        this.stopProcessTreeRefresh();
      }

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
        // Unconditional: the scratch dir is browserless-owned even when the
        // caller brought their own data dir. Ordered after browser.close() for
        // the same reason as the data dir — Chrome releases its handles first.
        await this.removeScratchDir(session.scratchDir);
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
  ): Promise<BrowserlessSessionJSON[]> {
    const sessions = Array.from(this.browsers);
    // Skip the process-list read entirely when there's nothing to report -
    // no point forking `ps` for an empty /sessions response.
    const processTree =
      sessions.length > 0 ? await this.getProcessTree() : null;

    // Query browsers concurrently and tolerate individual failures — one
    // wedged or mid-shutdown browser shouldn't stall or 500 /sessions.
    let formattedSessions: BrowserlessSessionJSON[] = (
      await Promise.all(
        sessions.map(([browser, session]) =>
          this.generateSessionJson(browser, session, processTree).catch(
            (err) => {
              this.log.warn(
                `Error generating session JSON for "${session.id}": ${err}`,
              );
              return [];
            },
          ),
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

    // Give the browser its own TMPDIR so the scratch it abandons on SIGKILL is
    // inside a directory this session owns, instead of loose in the shared temp
    // dir where nothing can reclaim it. TMPDIR is applied last: `launch` is a
    // caller passthrough, and a session must not redirect its own scratch back
    // into the shared temp dir.
    //
    // Kept out of `launchOptions`, which is stored on the session and served
    // by /sessions: this merge carries the whole server environment, so
    // writing it there would publish TOKEN and any host credentials. It is
    // handed to `launch` alone. The spread of `process.env` is required
    // because both launchers replace the child environment wholesale when
    // `env` is given rather than merging it over their own default.
    let scratchDir: string;
    try {
      scratchDir = await generateScratchDir(undefined, this.config);
    } catch (err) {
      // CDP's auto-generated data dir already exists at this point, but no
      // BrowserlessSession exists yet to route through the normal close path.
      if (!manualUserDataDir && userDataDir) {
        await this.removeUserDataDir(userDataDir);
      }
      throw err;
    }
    const browserEnv = {
      ...process.env,
      ...(launchOptions as BrowserServerOptions).env,
      TMPDIR: scratchDir,
    };

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
        options: { ...launchOptions, env: browserEnv } as BrowserServerOptions,
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
      // Owned by browserless regardless of who supplied the data dir, so it is
      // reclaimed unconditionally.
      await this.removeScratchDir(scratchDir);
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
      scratchDir,
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
    this.startProcessTreeRefresh();

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
    this.stopProcessTreeRefresh();
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
