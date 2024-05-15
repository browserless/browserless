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
  FirefoxPlaywright,
  HTTPManagementRoutes,
  Hooks,
  Logger,
  NotFound,
  Request,
  ServerError,
  WebkitPlaywright,
  availableBrowsers,
  convertIfBase64,
  exists,
  generateDataDir,
  makeExternalURL,
  noop,
  parseBooleanParam,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import { deleteAsync } from 'del';
import path from 'path';

export class BrowserManager {
  protected browsers: Map<BrowserInstance, BrowserlessSession> = new Map();
  protected timers: Map<string, number> = new Map();
  protected log = new Logger('browser-manager');
  protected chromeBrowsers = [ChromiumCDP, ChromeCDP];
  protected playwrightBrowserNames = [
    ChromiumPlaywright.name,
    ChromePlaywright.name,
    FirefoxPlaywright.name,
    WebkitPlaywright.name,
  ];

  constructor(
    protected config: Config,
    protected hooks: Hooks,
  ) {}

  protected browserIsChrome = (b: BrowserInstance) =>
    this.chromeBrowsers.some((chromeBrowser) => b instanceof chromeBrowser);

  protected removeUserDataDir = async (userDataDir: string | null) => {
    if (userDataDir && (await exists(userDataDir))) {
      this.log.info(`Deleting data directory "${userDataDir}"`);
      await deleteAsync(userDataDir, { force: true }).catch((err) => {
        this.log.error(
          `Error cleaning up user-data-dir "${err}" at ${userDataDir}`,
        );
      });
    }
  };

  protected onNewPage = async (req: Request, page: Page) => {
    await this.hooks.page({ meta: req.parsed, page });
  };

  /**
   * Returns the /json/protocol API contents from Chromium or Chrome, whichever is installed,
   * and modifies URLs to set them to the appropriate addresses configured.
   * When both Chrome and Chromium are installed, defaults to Chromium.
   */
  public getProtocolJSON = async (logger: Logger): Promise<object> => {
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
    await browser.launch();
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new Error('There was an error launching the browser');
    }

    const { port } = new URL(wsEndpoint);
    const res = await fetch(`http://127.0.0.1:${port}/json/protocol`);
    const protocolJSON = await res.json();

    browser.close();

    return protocolJSON;
  };

  /**
   * Returns the /json/version API from Chromium or Chrome, whichever is installed,
   * and modifies URLs to set them to the appropriate addresses configured.
   * When both Chrome and Chromium are installed, defaults to Chromium.
   */
  public getVersionJSON = async (logger: Logger): Promise<CDPJSONPayload> => {
    this.log.info(`Launching Chromium to generate /json/version results`);
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
    await browser.launch();
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
  };

  /**
   * Returns a list of all Chrome-like browsers (both Chromium and Chrome) with
   * their respective /json/list contents. URLs are modified so that subsequent
   * calls can be forwarded to the appropriate destination
   */
  public getJSONList = async (): Promise<Array<CDPJSONPayload>> => {
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
  };

  protected generateSessionJson = async (
    browser: BrowserInstance,
    session: BrowserlessSession,
  ) => {
    const serverAddress = this.config.getExternalAddress();

    const sessions = [
      {
        ...session,
        browser: browser.constructor.name,
        browserId: browser.wsEndpoint()?.split('/').pop() as string,
        initialConnectURL: new URL(session.initialConnectURL, serverAddress)
          .href,
        killURL: session.id
          ? makeExternalURL(
              serverAddress,
              HTTPManagementRoutes.sessions,
              session.id,
            )
          : null,
        running: browser.isRunning(),
        timeAliveMs: Date.now() - session.startedOn,
        type: 'browser',
      },
    ];

    const wsEndpoint = browser.wsEndpoint();
    if (this.browserIsChrome(browser) && wsEndpoint) {
      const port = new URL(wsEndpoint).port;
      const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
        headers: {
          Host: '127.0.0.1',
        },
      });
      if (response.ok) {
        const body = await response.json();
        for (const page of body) {
          sessions.push({
            ...sessions[0],
            ...page,
            browserWSEndpoint: wsEndpoint,
          });
        }
      }
    }
    return sessions;
  };

  public close = async (
    browser: BrowserInstance,
    session: BrowserlessSession,
  ): Promise<void> => {
    const cleanupACtions: Array<() => Promise<void>> = [];
    this.log.info(`${session.numbConnected} Client(s) are currently connected`);

    // Don't close if there's clients still connected
    if (session.numbConnected > 0 || browser.keepAlive()) {
      return;
    }

    this.log.info(`Closing browser session`);
    cleanupACtions.push(() => browser.close());

    if (session.isTempDataDir) {
      this.log.info(
        `Deleting "${session.userDataDir}" user-data-dir and session from memory`,
      );
      this.browsers.delete(browser);
      cleanupACtions.push(() => this.removeUserDataDir(session.userDataDir));
    }

    await Promise.all(cleanupACtions.map((a) => a()));
  };

  public getAllSessions = async (): Promise<BrowserlessSessionJSON[]> => {
    const sessions = Array.from(this.browsers);

    const formattedSessions: BrowserlessSessionJSON[] = [];
    for (const [browser, session] of sessions) {
      const formattedSession = await this.generateSessionJson(browser, session);
      formattedSessions.push(...formattedSession);
    }
    return formattedSessions;
  };

  public complete = async (browser: BrowserInstance): Promise<void> => {
    const session = this.browsers.get(browser);
    if (!session) {
      this.log.info(
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
  };

  public getBrowserForRequest = async (
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
    logger: Logger,
  ): Promise<BrowserInstance> => {
    const { browser: Browser } = router;
    const blockAds = parseBooleanParam(
      req.parsed.searchParams,
      'blockAds',
      false,
    );
    const decodedLaunchOptions = convertIfBase64(
      req.parsed.searchParams.get('launch') || '{}',
    );
    let parsedLaunchOptions: BrowserServerOptions | CDPLaunchOptions;

    // Handle browser re-connects here
    if (req.parsed.pathname.includes('/devtools/browser')) {
      const sessions = Array.from(this.browsers);
      const id = req.parsed.pathname.split('/').pop() as string;
      const found = sessions.find(([b]) =>
        b.wsEndpoint()?.includes(req.parsed.pathname),
      );

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
      const id = req.parsed.pathname.split('/').pop() as string;
      if (!id.includes(BLESS_PAGE_IDENTIFIER)) {
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
                const body = await response.json();
                // @ts-ignore
                return body.map((b) => ({ ...b, browser }));
              }
              return null;
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

    const manualUserDataDir =
      launchOptions.args
        ?.find((arg) => arg.includes('--user-data-dir='))
        ?.split('=')[1] || (launchOptions as CDPLaunchOptions).userDataDir;

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

    if (
      launchOptions.args &&
      proxyServerArg &&
      req.parsed.pathname.startsWith('/playwright')
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

    const session: BrowserlessSession = {
      id: null,
      initialConnectURL:
        path.join(req.parsed.pathname, req.parsed.search) || '',
      isTempDataDir: !manualUserDataDir,
      launchOptions,
      numbConnected: 1,
      resolver: noop,
      routePath: router.path,
      startedOn: Date.now(),
      ttl: 0,
      userDataDir,
    };

    this.browsers.set(browser, session);

    await browser.launch(launchOptions as object);
    await this.hooks.browser({ browser, meta: req.parsed });

    browser.on('newPage', async (page) => {
      await this.onNewPage(req, page);
      (router.onNewPage || noop)(req.parsed || '', page);
    });

    return browser;
  };

  public shutdown = async (): Promise<void> => {
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
  };

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop = () => {};
}
