import * as fs from 'fs/promises';
import * as path from 'path';

import {
  Logger as BlessLogger,
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  ChromeCDP,
  ChromiumCDP,
  ChromiumPlaywright,
  Config,
  EdgeCDP,
  EdgePlaywright,
  FileSystem,
  FirefoxPlaywright,
  HTTPRoute,
  HTTPServer,
  Hooks,
  IBrowserlessStats,
  Limiter,
  Metrics,
  Monitoring,
  Router,
  SessionReplay,
  Token,
  WebHooks,
  WebKitPlaywright,
  WebSocketRoute,
  availableBrowsers,
  dedent,
  getRouteFiles,
  makeExternalURL,
  normalizeFileProtocol,
  printLogo,
  safeParse,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { userInfo } from 'os';

import { ServiceContainer } from './container/container.js';
import { createContainer, Services } from './container/bootstrap.js';

const routeSchemas = ['body', 'query'];

const isArm64 = process.arch === 'arm64';
const isMacOS = process.platform === 'darwin';
const unavailableARM64Browsers = ['edge', 'chrome'];

type Implements<T> = {
  new (...args: unknown[]): T;
};

type routeInstances =
  | HTTPRoute
  | BrowserHTTPRoute
  | WebSocketRoute
  | BrowserWebsocketRoute;

export class Browserless extends EventEmitter {
  protected logger: BlessLogger;
  protected browserManager: BrowserManager;
  protected config: Config;
  protected fileSystem: FileSystem;
  protected hooks: Hooks;
  protected limiter: Limiter;
  protected Logger: typeof BlessLogger;
  protected metrics: Metrics;
  protected monitoring: Monitoring;
  protected router: Router;
  protected sessionReplay: SessionReplay;
  protected token: Token;
  protected webhooks: WebHooks;
  protected staticSDKDir: string | null = null;

  disabledRouteNames: string[] = [];
  webSocketRouteFiles: string[] = [];
  httpRouteFiles: string[] = [];
  server?: HTTPServer;
  metricsSaveInterval: number = 5 * 60 * 1000;
  metricsSaveIntervalID?: NodeJS.Timer;

  constructor({
    browserManager,
    config,
    fileSystem,
    hooks,
    limiter,
    Logger: LoggerOverride,
    metrics,
    monitoring,
    router,
    sessionReplay,
    token,
    webhooks,
  }: {
    Logger?: Browserless['Logger'];
    browserManager?: Browserless['browserManager'];
    config?: Browserless['config'];
    fileSystem?: Browserless['fileSystem'];
    hooks?: Browserless['hooks'];
    limiter?: Browserless['limiter'];
    metrics?: Browserless['metrics'];
    monitoring?: Browserless['monitoring'];
    router?: Browserless['router'];
    sessionReplay?: Browserless['sessionReplay'];
    token?: Browserless['token'];
    webhooks?: Browserless['webhooks'];
  } = {}) {
    super();
    this.Logger = LoggerOverride ?? BlessLogger;
    this.logger = new this.Logger('index');
    this.config = config || new Config();
    this.metrics = metrics || new Metrics();
    this.token = token || new Token(this.config);
    this.hooks = hooks || new Hooks();
    this.webhooks = webhooks || new WebHooks(this.config);
    this.monitoring = monitoring || new Monitoring(this.config);
    this.fileSystem = fileSystem || new FileSystem(this.config);
    this.sessionReplay = sessionReplay || new SessionReplay(this.config);
    this.browserManager =
      browserManager ||
      new BrowserManager(this.config, this.hooks, this.fileSystem, this.sessionReplay);
    this.limiter =
      limiter ||
      new Limiter(
        this.config,
        this.metrics,
        this.monitoring,
        this.webhooks,
        this.hooks,
      );
    this.router =
      router ||
      new Router(this.config, this.browserManager, this.limiter, this.Logger);
  }

  // Filter out routes that are not able to work on the arm64 architecture
  // and log a message as to why that is (can't run Chrome on non-apple arm64)
  protected filterNonMacArm64Browsers(
    route:
      | HTTPRoute
      | BrowserHTTPRoute
      | WebSocketRoute
      | BrowserWebsocketRoute,
  ) {
    if (
      isArm64 &&
      !isMacOS &&
      'browser' in route &&
      route.browser &&
      unavailableARM64Browsers.some((b) =>
        route.browser.name.toLowerCase().includes(b),
      )
    ) {
      this.logger.warn(
        `Ignoring route "${route.path}" because it is not supported on arm64 platforms (route requires browser "${route.browser.name}").`,
      );
      return false;
    }
    return true;
  }

  protected async loadPwVersions(): Promise<void> {
    const { playwrightVersions } = JSON.parse(
      (await fs.readFile('package.json')).toString(),
    );

    this.config.setPwVersions(playwrightVersions);
  }

  protected async saveMetrics(): Promise<void> {
    const metricsPath = this.config.getMetricsJSONPath();
    const { cpu, memory } = await this.monitoring.getMachineStats();
    const metrics = await this.metrics.get();
    const aggregatedStats: IBrowserlessStats = {
      ...metrics,
      cpu,
      memory,
    };

    this.metrics.reset();

    this.logger.info(
      `Current period usage: ${JSON.stringify({
        date: aggregatedStats.date,
        error: aggregatedStats.error,
        maxConcurrent: aggregatedStats.maxConcurrent,
        maxTime: aggregatedStats.maxTime,
        meanTime: aggregatedStats.meanTime,
        minTime: aggregatedStats.minTime,
        rejected: aggregatedStats.rejected,
        successful: aggregatedStats.successful,
        timedout: aggregatedStats.timedout,
        totalTime: aggregatedStats.totalTime,
        units: aggregatedStats.units,
      })}`,
    );

    if (metricsPath) {
      this.logger.info(`Saving metrics to "${metricsPath}"`);
      this.fileSystem.append(
        metricsPath,
        JSON.stringify(aggregatedStats),
        false,
      );
    }
  }

  public setMetricsSaveInterval(interval: number) {
    if (interval <= 0) {
      return console.warn(
        `Interval value of "${interval}" must be greater than 1. Ignoring`,
      );
    }

    clearInterval(this.metricsSaveInterval);
    this.metricsSaveInterval = interval;
    this.metricsSaveIntervalID = setInterval(
      this.saveMetrics,
      this.metricsSaveInterval,
    );
  }

  protected routeIsDisabled(route: routeInstances) {
    return this.disabledRouteNames.some((name) => name === route.name);
  }

  public setStaticSDKDir(dir: string) {
    this.staticSDKDir = dir;
  }

  public disableRoutes(...routeNames: string[]) {
    this.disabledRouteNames.push(...routeNames);
  }

  public addHTTPRoute(httpRouteFilePath: string) {
    this.httpRouteFiles.push(httpRouteFilePath);
  }

  public addWebSocketRoute(webSocketRouteFilePath: string) {
    this.webSocketRouteFiles.push(webSocketRouteFilePath);
  }

  public setPort(port: number) {
    if (this.server) {
      throw new Error(
        `Server is already instantiated and bound to port ${this.config.getPort()}`,
      );
    }
    this.config.setPort(port);
  }

  public async stop() {
    clearInterval(this.metricsSaveIntervalID as unknown as number);
    return Promise.all([
      this.server?.shutdown(),
      this.browserManager.shutdown(),
      this.config.shutdown(),
      this.fileSystem.shutdown(),
      this.limiter.shutdown(),
      this.metrics.shutdown(),
      this.monitoring.shutdown(),
      this.router.shutdown(),
      this.sessionReplay.shutdown(),
      this.token.shutdown(),
      this.webhooks.shutdown(),
      this.hooks.shutdown(),
    ]);
  }

  public async start() {
    const httpRoutes: Array<HTTPRoute | BrowserHTTPRoute> = [];
    const wsRoutes: Array<WebSocketRoute | BrowserWebsocketRoute> = [];
    const internalBrowsers = [
      ChromiumCDP,
      ChromeCDP,
      EdgeCDP,
      FirefoxPlaywright,
      EdgePlaywright,
      ChromiumPlaywright,
      WebKitPlaywright,
    ];

    const [[internalHttpRouteFiles, internalWsRouteFiles], installedBrowsers] =
      await Promise.all([getRouteFiles(this.config), availableBrowsers]);

    const hasDebugger = await this.config.hasDebugger();
    const debuggerURL =
      hasDebugger &&
      makeExternalURL(this.config.getExternalAddress(), `/debugger/?token=xxx`);
    const docsLink = makeExternalURL(this.config.getExternalAddress(), '/docs');

    this.logger.info(printLogo(docsLink, debuggerURL));
    this.logger.info(`Running as user "${userInfo().username}"`);
    this.logger.debug('Starting import of HTTP Routes');

    for (const httpRoute of [
      ...this.httpRouteFiles,
      ...internalHttpRouteFiles,
    ]) {
      if (httpRoute.endsWith('js')) {
        const [bodySchema, querySchema] = await Promise.all(
          routeSchemas.map(async (schemaType) => {
            const schemaPath = path.parse(httpRoute);
            schemaPath.base = `${schemaPath.name}.${schemaType}.json`;
            return await readFile(path.format(schemaPath), 'utf-8').catch(
              () => '',
            );
          }),
        );

        const routeImport = `${
          this.config.getIsWin() ? 'file:///' : ''
        }${httpRoute}`;
        const {
          default: Route,
        }: { default: Implements<HTTPRoute> | Implements<BrowserHTTPRoute> } =
          await import(routeImport + `?cb=${Date.now()}`);
        const route = new Route(
          this.browserManager,
          this.config,
          this.fileSystem,
          this.metrics,
          this.monitoring,
          this.staticSDKDir,
          this.limiter,
        );

        if (!this.routeIsDisabled(route)) {
          route.bodySchema = safeParse(bodySchema);
          route.querySchema = safeParse(querySchema);
          route.config = () => this.config;
          route.limiter = () => this.limiter;
          route.metrics = () => this.metrics;
          route.monitoring = () => this.monitoring;
          route.fileSystem = () => this.fileSystem;
          route.staticSDKDir = () => this.staticSDKDir;
          route.sessionReplay = () => this.sessionReplay;

          httpRoutes.push(route);
        }
      }
    }

    this.logger.debug('Starting import of WebSocket Routes');
    for (const wsRoute of [
      ...this.webSocketRouteFiles,
      ...internalWsRouteFiles,
    ]) {
      if (wsRoute.endsWith('js')) {
        const [, querySchema] = await Promise.all(
          routeSchemas.map(async (schemaType) => {
            const schemaPath = path.parse(wsRoute);
            schemaPath.base = `${schemaPath.name}.${schemaType}.json`;
            return await readFile(path.format(schemaPath), 'utf-8').catch(
              () => '',
            );
          }),
        );

        const wsImport = normalizeFileProtocol(wsRoute);
        const {
          default: Route,
        }: {
          default:
            | Implements<WebSocketRoute>
            | Implements<BrowserWebsocketRoute>;
        } = await import(wsImport + `?cb=${Date.now()}`);
        const route = new Route(
          this.browserManager,
          this.config,
          this.fileSystem,
          this.metrics,
          this.monitoring,
          this.staticSDKDir,
          this.limiter,
        );

        if (!this.routeIsDisabled(route)) {
          route.querySchema = safeParse(querySchema);
          route.config = () => this.config;
          route.limiter = () => this.limiter;
          route.metrics = () => this.metrics;
          route.monitoring = () => this.monitoring;
          route.fileSystem = () => this.fileSystem;
          route.staticSDKDir = () => this.staticSDKDir;
          route.sessionReplay = () => this.sessionReplay;

          wsRoutes.push(route);
        }
      }
    }

    const allRoutes: [
      (HTTPRoute | BrowserHTTPRoute)[],
      (WebSocketRoute | BrowserWebsocketRoute)[],
    ] = [
      [...httpRoutes].filter((r) => this.filterNonMacArm64Browsers(r)),
      [...wsRoutes].filter((r) => this.filterNonMacArm64Browsers(r)),
    ];

    // Validate that we have the browsers they are asking for
    allRoutes
      .flat()
      .map((route) => {
        if (
          'browser' in route &&
          route.browser &&
          internalBrowsers.includes(route.browser) &&
          !installedBrowsers.some((b) => b.name === route.browser?.name)
        ) {
          throw new Error(
            dedent(`Couldn't load route "${route.path}" due to missing browser binary for "${route.browser?.name}".
            Installed Browsers: ${installedBrowsers.map((b) => b.name).join(', ')}`),
          );
        }
        return route;
      })
      .filter((e, i, a) => a.findIndex((r) => r.name === e.name) !== i)
      .map((r) => r.name)
      .forEach((name) => {
        this.logger.warn(
          `Found duplicate routing names. Route names must be unique: ${name}`,
        );
      });

    const [filteredHTTPRoutes, filteredWSRoutes] = allRoutes;

    filteredHTTPRoutes.forEach((r) => this.router.registerHTTPRoute(r));
    filteredWSRoutes.forEach((r) => this.router.registerWebSocketRoute(r));

    this.logger.debug(
      `Imported and validated all route files, starting up server.`,
    );

    this.server = new HTTPServer(
      this.config,
      this.metrics,
      this.token,
      this.router,
      this.hooks,
      this.Logger,
    );

    await this.loadPwVersions();
    await this.sessionReplay.initialize();

    // Wire VideoEncoder to the now-initialized store.
    // VideoEncoder gets null at construction time because SessionReplay.initialize()
    // creates the ReplayStore. Without this, all status updates are silent no-ops.
    const store = this.sessionReplay.getStore();
    if (store) {
      const encoder = this.browserManager.getReplayCoordinator().getVideoEncoder();
      encoder.setStore(store);
      await encoder.cleanupOrphans(this.sessionReplay.getReplaysDir());
    }

    await this.server.start();
    this.logger.debug(`Starting metrics collection.`);
    this.metricsSaveIntervalID = setInterval(
      () => this.saveMetrics(),
      this.metricsSaveInterval,
    );
  }

  /**
   * Create a Browserless instance from a service container.
   *
   * This factory method uses the centralized DI container for service resolution.
   * The container provides:
   * - Centralized service registration
   * - Circular dependency detection
   * - Startup validation
   * - Easy mocking for tests
   *
   * @param container Optional container. If not provided, creates a new one.
   * @example
   *   // Basic usage
   *   const browserless = Browserless.fromContainer();
   *
   *   // With custom overrides for testing
   *   const container = createContainer({
   *     config: new MockConfig(),
   *     replayStore: new MockReplayStore(),
   *   });
   *   const browserless = Browserless.fromContainer(container);
   */
  public static fromContainer(container?: ServiceContainer): Browserless {
    const c = container ?? createContainer();
    c.validate(); // Fail fast on missing deps

    return new Browserless({
      browserManager: c.resolve<BrowserManager>(Services.BrowserManager),
      config: c.resolve<Config>(Services.Config),
      fileSystem: c.resolve<FileSystem>(Services.FileSystem),
      hooks: c.resolve<Hooks>(Services.Hooks),
      limiter: c.resolve<Limiter>(Services.Limiter),
      Logger: c.resolve<typeof BlessLogger>(Services.Logger),
      metrics: c.resolve<Metrics>(Services.Metrics),
      monitoring: c.resolve<Monitoring>(Services.Monitoring),
      router: c.resolve<Router>(Services.Router),
      sessionReplay: c.resolve<SessionReplay>(Services.SessionReplay),
      token: c.resolve<Token>(Services.Token),
      webhooks: c.resolve<WebHooks>(Services.WebHooks),
    });
  }
}
