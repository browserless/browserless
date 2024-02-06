import {
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessSession,
  BrowserlessSessionJSON,
  CDPChromium,
  CDPLaunchOptions,
  Config,
  HTTPManagementRoutes,
  NotFound,
  PlaywrightChromium,
  PlaywrightFirefox,
  PlaywrightWebkit,
  Request,
  browserHook,
  convertIfBase64,
  createLogger,
  exists,
  generateDataDir,
  makeExternalURL,
  noop,
  pageHook,
  parseBooleanParam,
} from '@browserless.io/browserless';
import { deleteAsync } from 'del';
import path from 'path';

export class BrowserManager {
  protected browsers: Map<BrowserInstance, BrowserlessSession> = new Map();
  protected launching: Map<string, Promise<unknown>> = new Map();
  protected timers: Map<string, number> = new Map();
  protected debug = createLogger('browser-manager');
  protected playwrightBrowserNames = [
    PlaywrightChromium.name,
    PlaywrightFirefox.name,
    PlaywrightWebkit.name,
  ];

  constructor(protected config: Config) {}

  protected removeUserDataDir = async (userDataDir: string | null) => {
    if (userDataDir && (await exists(userDataDir))) {
      this.debug(`Deleting data directory "${userDataDir}"`);
      await deleteAsync(userDataDir, { force: true }).catch((err) => {
        this.debug(
          `Error cleaning up user-data-dir "${err}" at ${userDataDir}`,
        );
      });
    }
  };

  public getProtocolJSON = async (): Promise<object> => {
    this.debug(`Launching Chrome to generate /json/protocol results`);
    const browser = new CDPChromium({
      blockAds: false,
      config: this.config,
      record: false,
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

  public getVersionJSON = async (): Promise<{
    Browser: string;
    'Debugger-Version': string;
    'Protocol-Version': string;
    'User-Agent': string;
    'V8-Version': string;
    'WebKit-Version': string;
    webSocketDebuggerUrl: string;
  }> => {
    this.debug(`Launching Chrome to generate /json/version results`);
    const browser = new CDPChromium({
      blockAds: false,
      config: this.config,
      record: false,
      userDataDir: null,
    });
    await browser.launch();
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new Error('There was an error launching the browser');
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

  private generateSessionJson = async (
    browser: BrowserInstance,
    session: BrowserlessSession,
  ) => {
    const serverAddress = this.config.getExternalAddress();

    const sessions = [
      {
        ...session,
        browser: browser.constructor.name,
        browserId: browser.wsEndpoint()?.split('/').pop(),
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
    if (browser.constructor.name === 'CDPChromium' && wsEndpoint) {
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
    this.debug(`${session.numbConnected} Client(s) are currently connected`);

    this.debug(`Closing browser session`);
    cleanupACtions.push(() => browser.close());

    if (session.isTempDataDir) {
      this.debug(
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
      this.debug(`Couldn't locate session for browser, proceeding with close`);
      return browser.close();
    }

    const { id, resolver } = session;

    if (id && resolver) {
      resolver(null);
      this.launching.delete(id);
    }

    --session.numbConnected;

    this.close(browser, session);
  };

  public getBrowserForRequest = async (
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
  ): Promise<BrowserInstance> => {
    const { browser: Browser } = router;
    const record = parseBooleanParam(req.parsed.searchParams, 'record', false);
    const blockAds = parseBooleanParam(
      req.parsed.searchParams,
      'blockAds',
      false,
    );
    const decodedLaunchOptions = convertIfBase64(
      req.parsed.searchParams.get('launch') || '{}',
    );
    let parsedLaunchOptions: BrowserServerOptions | CDPLaunchOptions;

    // Handle re-connects here:
    if (req.parsed.pathname.includes('/devtools/browser')) {
      const sessions = Array.from(this.browsers);
      const id = req.parsed.pathname.split('/').pop() as string;
      const browser = sessions.find(([b]) =>
        b.wsEndpoint()?.includes(req.parsed.pathname),
      );

      if (browser) {
        this.debug(`Located browser with ID ${id}`);
        return browser[0];
      }

      throw new NotFound(
        `Couldn't locate browser "${id}" for request "${req.parsed.pathname}"`,
      );
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
      record,
      userDataDir,
    });

    const connectionMeta: BrowserlessSession = {
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

    this.browsers.set(browser, connectionMeta);

    await browser.launch(launchOptions as object);
    await browserHook({ browser, meta: req.parsed });

    browser.on('newPage', async (page) => {
      await pageHook({ meta: req.parsed, page });
      (router.onNewPage || noop)(req.parsed || '', page);
    });

    return browser;
  };

  public stop = async (): Promise<void> => {
    this.debug(`Closing down browser instances`);
    const sessions = Array.from(this.browsers);
    await Promise.all(sessions.map(([b]) => b.close()));
    const timers = Array.from(this.timers);
    await Promise.all(timers.map(([, timer]) => clearInterval(timer)));
    this.timers.forEach((t) => clearTimeout(t));
    this.browsers = new Map();
    this.timers = new Map();

    this.debug(`Shutdown complete`);
  };
}
