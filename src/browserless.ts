import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  Logger as BlessLogger,
  BrowserHTTPRoute,
  BrowserManager,
  BrowserQL,
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
  InvalidConfig,
  LifecycleConflict,
  LifecycleExpect,
  LifecycleSnapshot,
  Limiter,
  Metrics,
  Monitoring,
  Router,
  Token,
  WebHooks,
  WebKitPlaywright,
  WebSocketRoute,
  WorkerLifecycle,
  availableBrowsers,
  dedent,
  exists,
  getRouteFiles,
  makeExternalURL,
  normalizeFileProtocol,
  printLogo,
  safeParse,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { readFile } from 'fs/promises';
import { userInfo } from 'os';

const routeSchemas = ['body', 'query'];

const isArm64 = process.arch === 'arm64';
const isMacOS = process.platform === 'darwin';
const unavailableARM64Browsers = ['edge', 'chrome'];

type Implements<T> = {
  new (...args: unknown[]): T;
};

type routeInstances =
  HTTPRoute | BrowserHTTPRoute | WebSocketRoute | BrowserWebsocketRoute;

export interface ShutdownStep {
  name: string;
  run: () => Promise<unknown>;
}

export type ShutdownReport = LifecycleSnapshot & {
  /** All ordered shutdown steps finished; drainComplete alone is insufficient. */
  shutdownComplete: boolean;
  steps: Array<{
    name: string;
    status: 'pending' | 'done' | 'failed' | 'skipped';
    error?: string;
  }>;
};

export class Browserless extends EventEmitter {
  protected bql: BrowserQL;
  protected logger: BlessLogger;
  protected browserManager: BrowserManager;
  protected config: Config;
  protected fileSystem: FileSystem;
  protected hooks: Hooks;
  protected lifecycle: WorkerLifecycle;
  protected limiter: Limiter;
  protected Logger: typeof BlessLogger;
  protected metrics: Metrics;
  protected monitoring: Monitoring;
  protected router: Router;
  protected token: Token;
  protected webhooks: WebHooks;
  protected staticSDKDir: string | null = null;

  disabledRouteNames: string[] = [];
  webSocketRouteFiles: string[] = [];
  httpRouteFiles: string[] = [];
  server?: HTTPServer;
  metricsSaveInterval: number = 5 * 60 * 1000;
  metricsSaveIntervalID?: NodeJS.Timer;
  // Most-recent entries kept in the metrics JSON file (~35 days at the
  // default 5-minute cadence). Without a cap the file — and the in-memory
  // cache plus every /metrics response built from it — grows forever.
  metricsMaxEntries: number = 10_000;
  protected gracefulShutdown?: Promise<ShutdownReport>;
  protected serverShutdown = new WeakMap<HTTPServer, Promise<void>>();
  protected shutdownStepsFinished = false;
  // Owner of the metrics-save producer: its passes may run after closure
  // until the terminal stop clears the interval.
  protected metricsProducer = {};

  constructor({
    bql,
    browserManager,
    config,
    fileSystem,
    hooks,
    lifecycle,
    limiter,
    Logger: LoggerOverride,
    metrics,
    monitoring,
    router,
    token,
    webhooks,
  }: {
    Logger?: Browserless['Logger'];
    bql?: BrowserQL;
    browserManager?: Browserless['browserManager'];
    config?: Browserless['config'];
    fileSystem?: Browserless['fileSystem'];
    hooks?: Browserless['hooks'];
    lifecycle?: WorkerLifecycle;
    limiter?: Browserless['limiter'];
    metrics?: Browserless['metrics'];
    monitoring?: Browserless['monitoring'];
    router?: Browserless['router'];
    token?: Browserless['token'];
    webhooks?: Browserless['webhooks'];
  } = {}) {
    super();
    this.bql = bql ?? new BrowserQL();
    this.Logger = LoggerOverride ?? BlessLogger;
    this.logger = new this.Logger('index');
    this.config = config || new Config();
    this.metrics = metrics || new Metrics();
    this.token = token || new Token(this.config);
    this.hooks = hooks || new Hooks();
    this.webhooks = webhooks || new WebHooks(this.config);
    this.monitoring = monitoring || new Monitoring(this.config);
    this.fileSystem = fileSystem || new FileSystem(this.config);
    this.browserManager =
      browserManager ||
      new BrowserManager(this.config, this.hooks, this.fileSystem);
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
      new Router(
        this.config,
        this.browserManager,
        this.limiter,
        this.Logger,
        this.hooks,
      );
    // One process-local lifecycle shared by every module, including ones
    // the caller constructed and passed in.
    this.lifecycle = lifecycle || new WorkerLifecycle();
    this.browserManager.setLifecycle(this.lifecycle);
    this.limiter.setLifecycle(this.lifecycle);
    this.router.setLifecycle(this.lifecycle);
    this.lifecycle.admitAfterClose(this.metricsProducer);
  }

  public getLifecycle(): WorkerLifecycle {
    return this.lifecycle;
  }

  // Filter out routes that are not able to work on the arm64 architecture
  // and log a message as to why that is (can't run Chrome on non-apple arm64)
  protected filterNonMacArm64Browsers(
    route:
      HTTPRoute | BrowserHTTPRoute | WebSocketRoute | BrowserWebsocketRoute,
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
    // Consumer's package.json wins — downstream projects can declare their
    // own playwrightVersions to override the SDK's defaults. Tolerate a
    // missing consumer package.json (e.g. CWD detached from the project root)
    // and fall back to the SDK's map below; surface other read/parse errors.
    let consumerVersions: { [key: string]: string } | undefined;
    try {
      const consumerPkg = JSON.parse(
        (await fs.readFile('package.json')).toString(),
      );
      consumerVersions = consumerPkg.playwrightVersions;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    if (consumerVersions) {
      this.config.setPwVersions(consumerVersions);
      return;
    }

    // SDK consumers don't (and shouldn't have to) mirror the SDK's
    // playwrightVersions map in their own package.json. Fall back to the
    // SDK package's own map.
    const sdkPkgPath = fileURLToPath(
      new URL('../package.json', import.meta.url),
    );
    const { playwrightVersions: sdkVersions } = JSON.parse(
      (await fs.readFile(sdkPkgPath)).toString(),
    );

    if (!sdkVersions) {
      throw new Error(
        `playwrightVersions is missing from both the consumer's package.json and the SDK's package.json at ${sdkPkgPath}. The SDK package is malformed.`,
      );
    }

    this.config.setPwVersions(sdkVersions);
  }

  protected async loadInstalledBinaries(): Promise<void> {
    const pwVersions = this.config.getPwVersions();
    const browserTypes = ['chromium', 'firefox', 'webkit'] as const;

    await Promise.all(
      browserTypes.map(async (browserType) => {
        const installed: Array<[number, string, string]> = [];

        await Promise.all(
          Object.keys(pwVersions).map(async (version) => {
            const minor = parseFloat(version);
            if (isNaN(minor)) return;

            try {
              const pw = await this.config.loadPwVersion(version);
              const exePath = pw[browserType].executablePath();
              if (await exists(exePath)) {
                installed.push([minor, version, exePath]);
              }
            } catch {
              // Package not installed, skip
            }
          }),
        );

        installed.sort(([a], [b]) => a - b);
        this.config.setInstalledBinaries(browserType, installed);
      }),
    );
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
      // Awaited so a write rejection surfaces through saveMetrics()'s caller
      // (the setInterval .catch below) instead of becoming an unhandled
      // rejection — append() returns the raw, rejectable write task.
      await this.fileSystem.append(
        metricsPath,
        JSON.stringify(aggregatedStats),
        false,
        this.metricsMaxEntries,
      );
    }
  }

  /**
   * Owned recurring producer. Each pass is counted so the terminal stop waits
   * for one in flight; a failed save stays best-effort (logged, not a
   * completion blocker), as before.
   */
  protected runMetricsSave() {
    this.lifecycle
      .track('metrics-save', this.saveMetrics(), {
        owner: this.metricsProducer,
        required: false,
      })
      .catch((err) => this.logger.error(`Error saving metrics: ${err}`));
  }

  public setMetricsSaveInterval(interval: number) {
    if (interval <= 0) {
      return console.warn(
        `Interval value of "${interval}" must be greater than 1. Ignoring`,
      );
    }

    // Clear the running timer (not the interval duration) or both timers
    // keep firing and each one resets the other's metrics window.
    clearInterval(this.metricsSaveIntervalID as unknown as number);
    this.metricsSaveInterval = interval;
    this.metricsSaveIntervalID = setInterval(
      () => this.runMetricsSave(),
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

  /**
   * Ordered steps of the terminal stop. Each runs only after the previous
   * one resolved. SDK extensions insert their own steps (e.g. billing
   * finalization after `idle-barrier`, before the clients it needs stop) by
   * overriding this and splicing by name.
   */
  protected gracefulShutdownSteps(): ShutdownStep[] {
    return [
      {
        name: 'stop-metrics-interval',
        run: async () =>
          clearInterval(this.metricsSaveIntervalID as unknown as number),
      },
      // Stop accepting; idle keep-alive sockets close now, busy ones after
      // their response. Does not wait for open connections (see idle-barrier).
      { name: 'close-listener', run: async () => this.server?.stopAccepting() },
      // Everything still counted: arrivals, admitted requests, upgraded
      // sockets, after-hooks, cleanups, a metrics pass in flight. No deadline.
      {
        name: 'idle-barrier',
        run: () => this.lifecycle.whenIdle(),
      },
      { name: 'server', run: () => this.shutdownServer() },
      { name: 'router', run: () => this.router.shutdown() },
      { name: 'limiter', run: () => this.limiter.shutdown() },
      { name: 'browser-manager', run: () => this.browserManager.shutdown() },
      { name: 'hooks', run: () => this.hooks.shutdown() },
      { name: 'webhooks', run: () => this.webhooks.shutdown() },
      { name: 'token', run: () => this.token.shutdown() },
      { name: 'monitoring', run: () => this.monitoring.shutdown() },
      { name: 'metrics', run: () => this.metrics.shutdown() },
      { name: 'file-system', run: () => this.fileSystem.shutdown() },
      { name: 'config', run: () => this.config.shutdown() },
    ];
  }

  /**
   * Ordered terminal stop, separate from the forced `stop()`.
   *
   * Requires terminal admission closure first (`lifecycle.tryCloseAdmission`
   * reached `admissionClosed`). Runs `gracefulShutdownSteps()` in
   * order with no deadline. The first failing step is recorded as a lifecycle
   * failure and every later step is skipped, so dependencies of a component
   * that failed to stop stay up. `shutdownComplete` is true only if every step
   * resolved and nothing is outstanding, failed or uncovered afterwards; the
   * lifecycle then becomes `stopped`. Repeated calls return the same result.
   * It does not exit the process.
   *
   * An in-band caller gets an initiation acknowledgment, not final completion.
   * Its response and after-hook must settle before dependencies are stopped.
   * Await a call without `caller` out-of-band to obtain the final report.
   */
  public async shutdownGracefully(
    expect: LifecycleExpect,
    opts: { caller?: object } = {},
  ): Promise<ShutdownReport> {
    this.lifecycle.checkExpect(expect);
    if (!this.gracefulShutdown) {
      const before = this.lifecycle.snapshot();
      if (before.state !== 'admissionClosed') {
        throw new LifecycleConflict(
          `Cannot shut down before admission closes (state ${before.state})`,
        );
      }
      this.gracefulShutdown = this.runGracefulShutdown();
    }
    if (opts.caller && !this.shutdownStepsFinished) {
      return {
        ...this.lifecycle.snapshot(),
        shutdownComplete: false,
        steps: [],
      };
    }
    return this.gracefulShutdown;
  }

  protected async runGracefulShutdown(): Promise<ShutdownReport> {
    const defs = this.gracefulShutdownSteps();
    const steps: ShutdownReport['steps'] = defs.map(({ name }) => ({
      name,
      status: 'pending',
    }));
    for (let i = 0; i < defs.length; i++) {
      try {
        await defs[i].run();
        steps[i].status = 'done';
      } catch (err) {
        steps[i].status = 'failed';
        steps[i].error = err instanceof Error ? err.message : String(err);
        this.lifecycle.recordFailure(`shutdown:${defs[i].name}`, err);
        for (const later of steps.slice(i + 1)) later.status = 'skipped';
        break;
      }
    }
    this.shutdownStepsFinished = steps.every((s) => s.status === 'done');
    this.lifecycle.markShutdownComplete();
    const after = this.lifecycle.snapshot();
    const shutdownComplete =
      after.state === 'stopped' && this.shutdownStepsFinished;
    return { ...after, shutdownComplete, steps };
  }

  protected shutdownServer(): Promise<void> {
    const server = this.server;
    if (!server) return Promise.resolve();
    const existing = this.serverShutdown.get(server);
    if (existing) return existing;
    const pending = new Promise<void>((resolve) => resolve(server.shutdown()));
    this.serverShutdown.set(server, pending);
    // Preserve explicit forced-stop retries after an override fails.
    void pending.catch(() => this.serverShutdown.delete(server));
    return pending;
  }

  public async stop() {
    // Preserve forced shutdown while graceful cleanup is pending or failed.
    if (this.shutdownStepsFinished) return [];
    clearInterval(this.metricsSaveIntervalID as unknown as number);
    const pending = [
      this.server,
      this.browserManager,
      this.config,
      this.fileSystem,
      this.limiter,
      this.metrics,
      this.monitoring,
      this.router,
      this.token,
      this.webhooks,
      this.hooks,
    ].map((component) => {
      try {
        if (component === this.server) return this.shutdownServer();
        return component?.shutdown();
      } catch (error) {
        return Promise.reject(error);
      }
    });
    try {
      return await Promise.all(pending);
    } catch (error) {
      // Preserve the first rejection, but don't let callers exit while other
      // cleanup attempts are still running.
      await Promise.allSettled(pending);
      throw error;
    }
  }

  public async start() {
    if (this.config.getStrictTokenUse() && !this.config.getToken()) {
      throw new InvalidConfig(
        `STRICT_TOKEN_USE is enabled but no TOKEN is configured. Set TOKEN or disable STRICT_TOKEN_USE.`,
      );
    }

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
    const docsLink = makeExternalURL(
      this.config.getExternalAddress(),
      '/docs/',
    );

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
          this.bql,
        );

        if (!this.routeIsDisabled(route)) {
          route.bodySchema = safeParse(bodySchema);
          route.querySchema = safeParse(querySchema);
          route.bql = () => this.bql;
          route.config = () => this.config;
          route.limiter = () => this.limiter;
          route.metrics = () => this.metrics;
          route.monitoring = () => this.monitoring;
          route.fileSystem = () => this.fileSystem;
          route.staticSDKDir = () => this.staticSDKDir;

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
            Implements<WebSocketRoute> | Implements<BrowserWebsocketRoute>;
        } = await import(wsImport + `?cb=${Date.now()}`);
        const route = new Route(
          this.browserManager,
          this.config,
          this.fileSystem,
          this.metrics,
          this.monitoring,
          this.staticSDKDir,
          this.limiter,
          this.bql,
        );

        if (!this.routeIsDisabled(route)) {
          route.querySchema = safeParse(querySchema);
          route.bql = () => this.bql;
          route.config = () => this.config;
          route.limiter = () => this.limiter;
          route.metrics = () => this.metrics;
          route.monitoring = () => this.monitoring;
          route.fileSystem = () => this.fileSystem;
          route.staticSDKDir = () => this.staticSDKDir;

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
    await this.loadInstalledBinaries();
    this.server.setLifecycle(this.lifecycle);
    await this.server.start();
    this.logger.debug(`Starting metrics collection.`);
    this.metricsSaveIntervalID = setInterval(
      () => this.runMetricsSave(),
      this.metricsSaveInterval,
    );
  }
}
