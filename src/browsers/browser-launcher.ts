import {
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserServerOptions,
  BrowserlessSession,
  CDPLaunchOptions,
  ChromeCDP,
  ChromePlaywright,
  ChromiumCDP,
  ChromiumPlaywright,
  Config,
  EdgeCDP,
  EdgePlaywright,
  FirefoxPlaywright,
  Hooks,
  Logger,
  NotFound,
  Request,
  WebKitPlaywright,
  BrowserWebsocketRoute,
  convertIfBase64,
  generateDataDir,
  getFinalPathSegment,
  noop,
  parseBooleanParam,
  parseStringParam,
  pwVersionRegex,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import micromatch from 'micromatch';
import path from 'path';

import { SessionRegistry } from '../session/session-registry.js';
import { RecordingCoordinator } from '../session/recording-coordinator.js';

/**
 * BrowserLauncher handles browser launch logic and option parsing.
 *
 * Responsibilities:
 * - Parse launch options from requests
 * - Handle browser reconnection
 * - Configure proxy settings
 * - Launch new browser instances
 *
 * This class is extracted from BrowserManager to reduce its complexity.
 */
export class BrowserLauncher {
  private reconnectionPatterns = ['/devtools/browser', '/function/connect'];
  private chromeBrowsers = [ChromiumCDP, ChromeCDP, EdgeCDP];
  private playwrightBrowserNames = [
    ChromiumPlaywright.name,
    ChromePlaywright.name,
    EdgePlaywright.name,
    FirefoxPlaywright.name,
    WebKitPlaywright.name,
  ];
  private log = new Logger('browser-launcher');

  constructor(
    private config: Config,
    private hooks: Hooks,
    private registry: SessionRegistry,
    private recordingCoordinator?: RecordingCoordinator
  ) {}

  /**
   * Check if a browser is Chrome-like.
   */
  browserIsChrome(b: BrowserInstance): boolean {
    return this.chromeBrowsers.some(
      (chromeBrowser) => b instanceof chromeBrowser,
    );
  }

  /**
   * Get a browser for a request.
   * Handles reconnection to existing browsers and launching new ones.
   */
  async getBrowserForRequest(
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

    // Handle trackingId validation
    if (trackingId) {
      if (this.registry.hasTrackingId(trackingId)) {
        throw new BadRequest(
          `A browser session with trackingId "${trackingId}" already exists`,
        );
      }

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

    // Handle browser reconnection
    if (
      this.reconnectionPatterns.some((p) => req.parsed.pathname.includes(p))
    ) {
      return this.handleReconnection(req);
    }

    // Handle page connections
    if (req.parsed.pathname.includes('/devtools/page')) {
      return this.handlePageConnection(req);
    }

    // Parse launch options
    const launchOptions = this.parseLaunchOptions(req, router);

    // Determine user data directory
    const manualUserDataDir = this.getManualUserDataDir(launchOptions);
    const userDataDir =
      manualUserDataDir ||
      (!this.playwrightBrowserNames.includes(Browser.name)
        ? await generateDataDir(undefined, this.config)
        : null);

    // Remove user-data-dir from args if set manually
    if (manualUserDataDir && launchOptions.args) {
      launchOptions.args = launchOptions.args.filter(
        (arg) => !arg.includes('--user-data-dir='),
      );
    }

    // Handle proxy configuration for Playwright
    this.configureProxy(launchOptions, req);

    // Handle deprecated options
    this.handleDeprecatedOptions(launchOptions);

    // Create browser instance
    const browser = new Browser({
      blockAds,
      config: this.config,
      logger,
      userDataDir,
    });

    // Get Playwright version from user agent
    const match = (req.headers['user-agent'] || '').match(pwVersionRegex);
    const pwVersion = match ? match[1] : 'default';

    // Pre-create session object
    const session: BrowserlessSession = {
      id: '', // Will be set after launch
      initialConnectURL:
        path.join(req.parsed.pathname, req.parsed.search) || '',
      isTempDataDir: !manualUserDataDir,
      launchOptions,
      numbConnected: 1,
      replay: replay && this.recordingCoordinator?.isEnabled(),
      resolver: noop,
      routePath: router.path,
      startedOn: Date.now(),
      trackingId,
      ttl: 0,
      userDataDir,
    };

    // Register newPage handler BEFORE launch
    browser.on('newPage', async (page: Page) => {
      await this.onNewPage(req, page, session);
      (router.onNewPage || noop)(req.parsed || '', page);
    });

    // Launch browser
    await browser.launch({
      options: launchOptions as BrowserServerOptions,
      pwVersion,
      req,
      stealth: 'stealth' in launchOptions ? launchOptions.stealth : undefined,
    });
    await this.hooks.browser({ browser, req });

    // Get session ID from wsEndpoint
    const sessionId = getFinalPathSegment(browser.wsEndpoint()!)!;
    session.id = sessionId;

    // Update logger context
    logger.setSessionContext({
      trackingId,
      sessionId,
    });

    // Register session
    this.registry.register(browser, session);

    // Start recording if enabled (non-blocking)
    if (session.replay && this.recordingCoordinator) {
      this.recordingCoordinator.startRecording(sessionId, trackingId);
      this.recordingCoordinator.setupRecordingForAllTabs(browser, sessionId).catch((e) => {
        this.log.warn(`Recording setup failed for session ${sessionId}: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    return browser;
  }

  /**
   * Handle reconnection to existing browser.
   */
  private handleReconnection(req: Request): BrowserInstance {
    const id = getFinalPathSegment(req.parsed.pathname);
    if (!id) {
      throw new NotFound(
        `Couldn't locate browser ID from path "${req.parsed.pathname}"`,
      );
    }

    const found = this.registry.findByWsEndpoint(id);
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

  /**
   * Handle page connection to existing browser.
   */
  private async handlePageConnection(req: Request): Promise<BrowserInstance> {
    const BLESS_PAGE_IDENTIFIER = '__browserless_session__';
    const id = getFinalPathSegment(req.parsed.pathname);

    if (!id?.includes(BLESS_PAGE_IDENTIFIER)) {
      const sessions = this.registry.toArray();
      const allPages = await Promise.all(
        sessions
          .filter(([b]) => !!b.wsEndpoint())
          .map(async ([browser]) => {
            const { port } = new URL(browser.wsEndpoint() as string);
            const response = await fetch(
              `http://127.0.0.1:${port}/json/list`,
              { headers: { Host: '127.0.0.1' } },
            ).catch(() => ({
              json: () => Promise.resolve([]),
              ok: false,
            }));
            if (response.ok) {
              const body: Array<{ id: string }> = await response.json();
              return body.map((b) => ({ ...b, browser }));
            }
            return [];
          }),
      );
      const found = allPages.flat().find((b) => b.id === id);

      if (found) {
        const session = this.registry.get(found.browser)!;
        ++session.numbConnected;
        return found.browser;
      }

      throw new NotFound(
        `Couldn't locate browser "${id}" for request "${req.parsed.pathname}"`,
      );
    }

    // Handle BLESS page identifier case
    throw new NotFound(
      `Couldn't locate browser for request "${req.parsed.pathname}"`,
    );
  }

  /**
   * Parse launch options from request.
   */
  private parseLaunchOptions(
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
  ): BrowserServerOptions | CDPLaunchOptions {
    const decodedLaunchOptions = convertIfBase64(
      req.parsed.searchParams.get('launch') || '{}',
    );

    let parsedLaunchOptions: BrowserServerOptions | CDPLaunchOptions;
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

    // Handle proxy-server param
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

    return launchOptions;
  }

  /**
   * Get manual user data directory from launch options.
   */
  private getManualUserDataDir(
    launchOptions: BrowserServerOptions | CDPLaunchOptions,
  ): string | undefined {
    return (
      launchOptions.args
        ?.find((arg) => arg.includes('--user-data-dir='))
        ?.split('=')[1] || (launchOptions as CDPLaunchOptions).userDataDir
    );
  }

  /**
   * Configure proxy settings for Playwright.
   */
  private configureProxy(
    launchOptions: BrowserServerOptions | CDPLaunchOptions,
    req: Request,
  ): void {
    const proxyServerArg = launchOptions.args?.find((arg) =>
      arg.includes('--proxy-server='),
    );

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
  }

  /**
   * Handle deprecated launch options.
   */
  private handleDeprecatedOptions(
    launchOptions: BrowserServerOptions | CDPLaunchOptions,
  ): void {
    if (Object.hasOwn(launchOptions, 'ignoreHTTPSErrors')) {
      if (!Object.hasOwn(launchOptions, 'acceptInsecureCerts')) {
        (launchOptions as CDPLaunchOptions).acceptInsecureCerts = (
          launchOptions as CDPLaunchOptions
        ).ignoreHTTPSErrors;
      }
      delete (launchOptions as CDPLaunchOptions).ignoreHTTPSErrors;
    }
  }

  /**
   * Handle new page event.
   */
  private async onNewPage(
    req: Request,
    page: Page,
    _session?: BrowserlessSession,
  ): Promise<void> {
    await this.hooks.page({ meta: req.parsed, page });
  }
}
