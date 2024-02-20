import * as path from 'path';
import {
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  ChromeCDP,
  ChromiumCDP,
  ChromiumPlaywright,
  Config,
  FileSystem,
  FirefoxPlaywright,
  HTTPRoute,
  HTTPServer,
  IBrowserlessStats,
  Limiter,
  Metrics,
  Monitoring,
  Router,
  Token,
  WebHooks,
  WebSocketRoute,
  WebkitPlaywright,
  availableBrowsers,
  createLogger,
  getRouteFiles,
  makeExternalURL,
  printLogo,
  safeParse,
} from '@browserless.io/browserless';
import { readFile } from 'fs/promises';
import { userInfo } from 'os';

const routeSchemas = ['body', 'query'];

type Implements<T> = {
  new (...args: unknown[]): T;
};

export class Browserless {
  protected debug: debug.Debugger = createLogger('index');
  protected browserManager: BrowserManager;
  protected config: Config;
  protected fileSystem: FileSystem;
  protected limiter: Limiter;
  protected metrics: Metrics;
  protected monitoring: Monitoring;
  protected router: Router;
  protected token: Token;
  protected webhooks: WebHooks;

  webSocketRouteFiles: string[] = [];
  httpRouteFiles: string[] = [];
  server?: HTTPServer;
  metricsSaveInterval: number = 5 * 60 * 1000;
  metricsSaveIntervalID?: NodeJS.Timer;

  constructor({
    browserManager,
    config,
    fileSystem,
    limiter,
    metrics,
    monitoring,
    router,
    token,
    webhooks,
  }: {
    browserManager?: Browserless['browserManager'];
    config?: Browserless['config'];
    fileSystem?: Browserless['fileSystem'];
    limiter?: Browserless['limiter'];
    metrics?: Browserless['metrics'];
    monitoring?: Browserless['monitoring'];
    router?: Browserless['router'];
    token?: Browserless['token'];
    webhooks?: Browserless['webhooks'];
  } = {}) {
    this.config = config || new Config();
    this.metrics = metrics || new Metrics();
    this.token = token || new Token(this.config);
    this.webhooks = webhooks || new WebHooks(this.config);
    this.browserManager = browserManager || new BrowserManager(this.config);
    this.monitoring = monitoring || new Monitoring(this.config);
    this.fileSystem = fileSystem || new FileSystem(this.config);
    this.limiter =
      limiter ||
      new Limiter(this.config, this.metrics, this.monitoring, this.webhooks);
    this.router =
      router || new Router(this.config, this.browserManager, this.limiter);
  }

  protected saveMetrics = async (): Promise<void> => {
    const metricsPath = this.config.getMetricsJSONPath();
    const { cpu, memory } = await this.monitoring.getMachineStats();
    const metrics = await this.metrics.get();
    const aggregatedStats: IBrowserlessStats = {
      ...metrics,
      cpu,
      memory,
    };

    this.metrics.reset();

    this.debug(
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
      this.debug(`Saving metrics to "${metricsPath}"`);
      this.fileSystem.append(metricsPath, JSON.stringify(aggregatedStats));
    }
  };

  public setMetricsSaveInterval = (interval: number) => {
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
  };

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
    return Promise.all([this.server?.stop()]);
  }

  public async start() {
    const httpRoutes: Array<HTTPRoute | BrowserHTTPRoute> = [];
    const wsRoutes: Array<WebSocketRoute | BrowserWebsocketRoute> = [];
    const internalBrowsers = [
      ChromiumCDP,
      ChromeCDP,
      FirefoxPlaywright,
      ChromiumPlaywright,
      WebkitPlaywright,
    ];

    const [[httpRouteFiles, wsRouteFiles], installedBrowsers] =
      await Promise.all([getRouteFiles(this.config), availableBrowsers]);

    const docsLink = makeExternalURL(this.config.getExternalAddress(), '/docs');

    this.debug(printLogo(docsLink));
    this.debug(`Running as user "${userInfo().username}"`);
    this.debug('Starting import of HTTP Routes');

    for (const httpRoute of [...httpRouteFiles, ...this.httpRouteFiles]) {
      if (httpRoute.endsWith('js')) {
        const { name } = path.parse(httpRoute);
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
        const logger = createLogger(`http:${name}`);
        const {
          default: Route,
        }: { default: Implements<HTTPRoute> | Implements<BrowserHTTPRoute> } =
          await import(routeImport + `?cb=${Date.now()}`);
        const route = new Route(
          this.browserManager,
          this.config,
          this.fileSystem,
          logger,
          this.metrics,
          this.monitoring,
        );
        route.bodySchema = safeParse(bodySchema);
        route.querySchema = safeParse(querySchema);
        route.config = () => this.config;
        route.metrics = () => this.metrics;
        route.monitoring = () => this.monitoring;
        route.fileSystem = () => this.fileSystem;
        route.debug = () => logger;

        httpRoutes.push(route);
      }
    }

    this.debug('Starting import of WebSocket Routes');
    for (const wsRoute of [...wsRouteFiles, ...this.webSocketRouteFiles]) {
      if (wsRoute.endsWith('js')) {
        const { name } = path.parse(wsRoute);
        const [, querySchema] = await Promise.all(
          routeSchemas.map(async (schemaType) => {
            const schemaPath = path.parse(wsRoute);
            schemaPath.base = `${schemaPath.name}.${schemaType}.json`;
            return await readFile(path.format(schemaPath), 'utf-8').catch(
              () => '',
            );
          }),
        );

        const wsImport = `${
          this.config.getIsWin() ? 'file:///' : ''
        }${wsRoute}`;
        const logger = createLogger(`ws:${name}`);
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
          logger,
          this.metrics,
          this.monitoring,
        );
        route.querySchema = safeParse(querySchema);
        route.config = () => this.config;
        route.metrics = () => this.metrics;
        route.monitoring = () => this.monitoring;
        route.fileSystem = () => this.fileSystem;
        route.debug = () => logger;

        wsRoutes.push(route);
      }
    }

    // Validate that we have the browsers they are asking for
    [...httpRoutes, ...wsRoutes].forEach((route) => {
      if (
        'browser' in route &&
        route.browser &&
        internalBrowsers.includes(route.browser) &&
        !installedBrowsers.some((b) => b.name === route.browser?.name)
      ) {
        throw new Error(
          `Couldn't load route "${route.path}" due to missing browser binary for "${route.browser?.name}"`,
        );
      }
    });

    httpRoutes.forEach((r) => this.router.registerHTTPRoute(r));
    wsRoutes.forEach((r) => this.router.registerWebSocketRoute(r));

    this.debug(`Imported and validated all route files, starting up server.`);

    this.server = new HTTPServer(
      this.config,
      this.metrics,
      this.token,
      this.router,
    );

    await this.server.start();
    this.debug(`Starting metrics collection.`);
    this.metricsSaveIntervalID = setInterval(
      () => this.saveMetrics(),
      this.metricsSaveInterval,
    );
  }
}
