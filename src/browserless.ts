import { readFile } from 'fs/promises';
import { userInfo } from 'os';
import * as path from 'path';

import { BrowserManager } from './browsers/index.js';
import { Config } from './config.js';
import { FileSystem } from './file-system.js';
import { Limiter } from './limiter.js';
import { Metrics } from './metrics.js';
import { Monitoring } from './monitoring.js';
import { HTTPServer } from './server.js';

import {
  HTTPRoute,
  BrowserHTTPRoute,
  WebSocketRoute,
  BrowserWebsocketRoute,
  IBrowserlessStats,
} from './types.js';
import * as utils from './utils.js';
import { WebHooks } from './webhooks.js';

const debug = utils.createLogger('index');
const routeSchemas = ['body', 'query'];

export class Browserless {
  private config: Config;
  private monitoring: Monitoring;
  private metrics: Metrics;
  private fileSystem: FileSystem;
  private browserManager: BrowserManager;
  private limiter: Limiter;
  private webhooks: WebHooks;

  webSocketRouteFiles: string[] = [];
  httpRouteFiles: string[] = [];
  server?: HTTPServer;
  metricsSaveInterval: number = 5 * 60 * 1000;
  metricsSaveIntervalID?: NodeJS.Timer;

  constructor({
    browserManager,
    config,
    monitoring,
    limiter,
    metrics,
    fileSystem,
    webhooks,
  }: {
    browserManager?: BrowserManager;
    config?: Config;
    fileSystem?: FileSystem;
    limiter?: Limiter;
    metrics?: Metrics;
    monitoring?: Monitoring;
    webhooks?: WebHooks;
  } = {}) {
    this.config = config || new Config();
    this.metrics = metrics || new Metrics();
    this.webhooks = webhooks || new WebHooks(this.config);
    this.browserManager = browserManager || new BrowserManager(this.config);
    this.monitoring = monitoring || new Monitoring(this.config);
    this.fileSystem = fileSystem || new FileSystem(this.config);
    this.limiter =
      limiter ||
      new Limiter(this.config, this.metrics, this.monitoring, this.webhooks);
  }

  private saveMetrics = async (): Promise<void> => {
    const metricsPath = this.config.getMetricsJSONPath();
    const { cpu, memory } = await this.monitoring.getMachineStats();
    const metrics = await this.metrics.get();
    const aggregatedStats: IBrowserlessStats = {
      ...metrics,
      cpu,
      memory,
    };

    this.metrics.reset();

    debug(
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
      debug(`Saving metrics to "${metricsPath}"`);
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

    const [[httpRouteFiles, wsRouteFiles], availableBrowsers] =
      await Promise.all([
        utils.getRouteFiles(this.config),
        utils.availableBrowsers,
      ]);

    const docsLink = utils.makeExternalURL(
      this.config.getExternalAddress(),
      '/docs',
    );

    debug(utils.printLogo(docsLink));
    debug(`Running as user "${userInfo().username}"`);
    debug('Starting import of HTTP Routes');
    for (const httpRoute of httpRouteFiles) {
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
        const logger = utils.createLogger(`http:${name}`);
        const { default: route }: { default: HTTPRoute | BrowserHTTPRoute } =
          await import(routeImport + `?cb=${Date.now()}`);

        route.bodySchema = utils.safeParse(bodySchema);
        route.querySchema = utils.safeParse(querySchema);
        route._config = () => this.config;
        route._metrics = () => this.metrics;
        route._monitor = () => this.monitoring;
        route._fileSystem = () => this.fileSystem;
        route._debug = () => logger;

        httpRoutes.push(route);
      }
    }

    debug('Starting import of WebSocket Routes');
    for (const wsRoute of wsRouteFiles) {
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
        const logger = utils.createLogger(`ws:${name}`);
        const {
          default: route,
        }: { default: WebSocketRoute | BrowserWebsocketRoute } = await import(
          wsImport + `?cb=${Date.now()}`
        );

        route.querySchema = utils.safeParse(querySchema);
        route._config = () => this.config;
        route._metrics = () => this.metrics;
        route._monitor = () => this.monitoring;
        route._fileSystem = () => this.fileSystem;
        route._debug = () => logger;

        wsRoutes.push(route);
      }
    }

    // Validate that browsers are installed and route paths are unique
    [...httpRoutes, ...wsRoutes].forEach((route) => {
      if (
        route.browser &&
        !availableBrowsers.some((b) => b.name === route.browser.name)
      ) {
        throw new Error(
          `Couldn't load route "${route.path}" due to missing browser of "${route.browser.name}"`,
        );
      }
    });

    debug(`Imported and validated all route files, starting up server.`);

    this.server = new HTTPServer(
      this.config,
      this.metrics,
      this.browserManager,
      this.limiter,
      httpRoutes,
      wsRoutes,
    );

    await this.server.start();
    debug(`Starting metrics collection.`);
    this.metricsSaveIntervalID = setInterval(
      () => this.saveMetrics(),
      this.metricsSaveInterval,
    );
  }
}
