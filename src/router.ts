import {
  AfterResponse,
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  Config,
  HTTPManagementRoutes,
  HTTPRoute,
  Hooks,
  Limiter,
  Logger,
  Methods,
  PathTypes,
  Request,
  Response,
  Route,
  WebSocketRoute,
  contentTypes,
  isConnected,
  writeResponse,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import micromatch from 'micromatch';
import stream from 'stream';

// Returned by wrapHTTPHandler / wrapWebSocketHandler when the connection was
// already closed before any work could run. wrapWithAfterHook checks for it so
// after() isn't fired for a request that never executed.
const ROUTE_DID_NOT_RUN = Symbol('route-did-not-run');

const safeStringify = (value: unknown): string | undefined => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

export class Router extends EventEmitter {
  protected log = new Logger('router');
  protected httpRoutes: Array<HTTPRoute | BrowserHTTPRoute> = [];
  protected webSocketRoutes: Array<WebSocketRoute | BrowserWebsocketRoute> = [];
  protected hooks: Hooks;
  // Glob-to-regex compilation is expensive enough to matter when it runs
  // per-route per-request, so matchers are compiled once at registration.
  protected pathMatchers = new WeakMap<
    HTTPRoute | BrowserHTTPRoute | WebSocketRoute | BrowserWebsocketRoute,
    Array<(test: string) => boolean>
  >();

  constructor(
    protected config: Config,
    protected browserManager: BrowserManager,
    protected limiter: Limiter,
    protected logger: typeof Logger,
    hooks?: Hooks,
  ) {
    super();
    // Keep hooks optional to avoid breaking SDK consumers that subclass Router
    // and forward only the original 4 ctor args. The default Hooks.after() is
    // a no-op, so the silent failure mode here is "no after() firing for
    // concurrency=false routes" — same as before this PR — and a startup warn
    // makes it diagnosable.
    if (hooks) {
      this.hooks = hooks;
    } else {
      this.hooks = new Hooks();
      this.log.warn(
        'Router constructed without explicit hooks — after() will use the no-op default for concurrency=false routes. SDK consumers subclassing Router should forward hooks via super(...).',
      );
    }
  }

  protected routeMatches(
    route:
      HTTPRoute | BrowserHTTPRoute | WebSocketRoute | BrowserWebsocketRoute,
    pathname: string,
  ): boolean {
    const matchers = this.pathMatchers.get(route);
    if (matchers) {
      return matchers.some((m) => m(pathname));
    }
    // Routes added without going through register* (SDK subclasses
    // mutating the arrays directly) fall back to per-call compilation.
    return (route.path as Array<PathTypes>).some((p) =>
      micromatch.isMatch(pathname, p),
    );
  }

  protected compilePathMatchers(
    route:
      HTTPRoute | BrowserHTTPRoute | WebSocketRoute | BrowserWebsocketRoute,
  ) {
    this.pathMatchers.set(
      route,
      (route.path as Array<PathTypes>).map((p) =>
        micromatch.matcher(p as string),
      ),
    );
  }

  protected getTimeout(req: Request) {
    const timer = req.parsed.searchParams.get('timeout');

    return timer ? +timer : undefined;
  }

  protected onQueueFullHTTP(_req: Request, res: Response) {
    this.log.debug(`Queue is full, sending 429 response`);
    return writeResponse(res, 429, 'Too many requests');
  }

  protected onQueueFullWebSocket(_req: Request, socket: stream.Duplex) {
    this.log.debug(`Queue is full, sending 429 response`);
    return writeResponse(socket, 429, 'Too many requests');
  }

  protected onHTTPTimeout(_req: Request, res: Response) {
    this.log.error(`HTTP job has timedout, sending 429 response`);
    return writeResponse(res, 408, 'Request has timed out');
  }

  protected onWebsocketTimeout(_req: Request, socket: stream.Duplex) {
    this.log.error(`Websocket job has timedout, sending 429 response`);
    return writeResponse(socket, 408, 'Request has timed out');
  }

  /**
   * Wraps a route handler so that the `after()` lifecycle hook fires when the
   * handler resolves or rejects, for routes that bypass the Limiter
   * (`concurrency = false`). Without this, downstream after()-driven behavior
   * (metrics, audit, SDK overrides) would silently disappear for those routes.
   *
   * Skips firing when the handler returns the ROUTE_DID_NOT_RUN sentinel —
   * that means the connection had already closed before the handler ran, so
   * recording the request would be inaccurate.
   */
  protected wrapWithAfterHook<TArgs extends [Request, ...unknown[]], TResult>(
    handler: (...args: TArgs) => Promise<TResult | typeof ROUTE_DID_NOT_RUN>,
    route?: Route,
  ): (...args: TArgs) => Promise<TResult | typeof ROUTE_DID_NOT_RUN> {
    return async (...args: TArgs) => {
      const start = Date.now();
      const [req] = args;
      try {
        const result = await handler(...args);
        if (result !== ROUTE_DID_NOT_RUN) {
          this.fireAfterHook({ req, start, status: 'successful', route });
        }
        return result;
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : Object.assign(
                new Error(
                  typeof err === 'string'
                    ? err
                    : (safeStringify(err) ?? 'Unknown Error'),
                ),
                { cause: err },
              );
        this.fireAfterHook({ req, start, status: 'error', error, route });
        throw error;
      }
    };
  }

  protected fireAfterHook(jobInfo: AfterResponse) {
    // SDK overrides of Hooks.after may throw synchronously or return a
    // rejected promise. Promise.resolve(...) normalizes both shapes so a
    // broken hook never breaks the response path.
    Promise.resolve()
      .then(() => this.hooks.after(jobInfo))
      .catch((err) => {
        this.log.error(`Error in after() hook: ${err}`);
      });
  }

  protected wrapHTTPHandler(
    route: HTTPRoute | BrowserHTTPRoute,
    handler: HTTPRoute['handler'] | BrowserHTTPRoute['handler'],
  ) {
    return async (req: Request, res: Response) => {
      if (!isConnected(res)) {
        this.log.warn(`HTTP Request has closed prior to running`);
        return ROUTE_DID_NOT_RUN;
      }
      const logger = new this.logger(route.name, req);
      if (
        Object.getPrototypeOf(route) instanceof BrowserHTTPRoute &&
        'browser' in route &&
        route.browser
      ) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
          logger,
        );

        if (!isConnected(res)) {
          this.log.warn(`HTTP Request has closed prior to running`);
          this.browserManager.complete(browser);
          return ROUTE_DID_NOT_RUN;
        }

        if (!browser) {
          return writeResponse(res, 500, `Error loading the browser`);
        }

        try {
          this.log.trace(`Running found HTTP handler.`);
          return await Promise.race([
            handler(req, res, logger, browser),
            new Promise((resolve, reject) => {
              res.once('close', () => {
                if (!res.writableEnded) {
                  reject(new Error(`Request closed prior to writing results`));
                }
                this.log.trace(`Response has been written, resolving`);
                resolve(null);
              });
            }),
          ]);
        } finally {
          this.log.trace(`HTTP Request handler has finished.`);
          this.browserManager.complete(browser);
        }
      }

      return (handler as HTTPRoute['handler'])(req, res, logger);
    };
  }

  protected wrapWebSocketHandler(
    route: WebSocketRoute | BrowserWebsocketRoute,
    handler: WebSocketRoute['handler'] | BrowserWebsocketRoute['handler'],
  ) {
    return async (req: Request, socket: stream.Duplex, head: Buffer) => {
      if (!isConnected(socket)) {
        this.log.warn(`WebSocket Request has closed prior to running`);
        return ROUTE_DID_NOT_RUN;
      }
      const logger = new this.logger(route.name, req);
      if (
        Object.getPrototypeOf(route) instanceof BrowserWebsocketRoute &&
        'browser' in route &&
        route.browser
      ) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
          logger,
        );

        if (!isConnected(socket)) {
          this.log.warn(`WebSocket Request has closed prior to running`);
          this.browserManager.complete(browser);
          return ROUTE_DID_NOT_RUN;
        }

        if (!browser) {
          return writeResponse(socket, 500, `Error loading the browser.`);
        }

        try {
          this.log.trace(`Running found WebSocket handler.`);
          await handler(req, socket, head, logger, browser);
        } finally {
          this.log.trace(`WebSocket Request handler has finished.`);
          this.browserManager.complete(browser);
        }
        return;
      }
      return (handler as WebSocketRoute['handler'])(req, socket, head, logger);
    };
  }

  public registerHTTPRoute(
    route: HTTPRoute | BrowserHTTPRoute,
  ): HTTPRoute | BrowserHTTPRoute {
    this.log.trace(
      `Registering HTTP ${route.method.toUpperCase()} ${route.path}`,
    );

    const bound = route.handler.bind(route);
    const wrapped = this.wrapHTTPHandler(route, bound);

    // Invariant: exactly one of limiter.limit / wrapWithAfterHook wraps the
    // handler, so hooks.after() fires exactly once per request.
    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullHTTP.bind(this),
          this.onHTTPTimeout.bind(this),
          this.getTimeout.bind(this),
          route.bypassLimits?.bind(route),
          route,
        )
      : this.wrapWithAfterHook(wrapped, route);
    route.path = Array.isArray(route.path) ? route.path : [route.path];
    this.compilePathMatchers(route);
    const registeredPaths = this.httpRoutes.map((r) => r.path).flat();
    const duplicatePaths = registeredPaths.filter((path) =>
      route.path.includes(path),
    );

    if (duplicatePaths.length) {
      this.log.warn(`Found duplicate routes: ${duplicatePaths.join(', ')}`);
    }
    this.httpRoutes.push(route);

    return route;
  }

  public registerWebSocketRoute(
    route: WebSocketRoute | BrowserWebsocketRoute,
  ): WebSocketRoute | BrowserWebsocketRoute {
    this.log.trace(`Registering WebSocket "${route.path}"`);

    const bound = route.handler.bind(route);
    const wrapped = this.wrapWebSocketHandler(route, bound);

    // Invariant: exactly one of limiter.limit / wrapWithAfterHook wraps the
    // handler, so hooks.after() fires exactly once per request.
    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullWebSocket.bind(this),
          this.onWebsocketTimeout.bind(this),
          this.getTimeout.bind(this),
          route.bypassLimits?.bind(route),
          route,
        )
      : this.wrapWithAfterHook(wrapped, route);
    route.path = Array.isArray(route.path) ? route.path : [route.path];
    this.compilePathMatchers(route);
    const registeredPaths = this.webSocketRoutes.map((r) => r.path).flat();
    const duplicatePaths = registeredPaths.filter((path) =>
      route.path.includes(path),
    );

    if (duplicatePaths.length) {
      this.log.warn(`Found duplicate routes: ${duplicatePaths.join(', ')}`);
    }
    this.webSocketRoutes.push(route);
    return route;
  }

  public getStaticHandler() {
    return this.httpRoutes.find((route) =>
      route.path.includes(HTTPManagementRoutes.static),
    ) as HTTPRoute;
  }

  public async getRouteForHTTPRequest(req: Request) {
    const accepts = (req.headers['accept']?.toLowerCase() || '*/*').split(',');
    const contentType = req.headers['content-type']
      ?.toLowerCase()
      ?.split(';')
      .shift() as contentTypes | undefined;

    return (
      this.httpRoutes.find(
        (r) =>
          this.routeMatches(r, req.parsed.pathname) &&
          r.method === (req.method?.toLocaleLowerCase() as Methods) &&
          (accepts.some((a) => a.includes('*/*')) ||
            r.contentTypes.some((contentType) =>
              accepts.includes(contentType),
            )) &&
          ((!contentType && r.accepts.includes(contentTypes.any)) ||
            r.accepts.includes(contentType as contentTypes)),
      ) ||
      (req.method?.toLowerCase() === 'get' ? this.getStaticHandler() : null)
    );
  }

  public async getRouteForWebSocketRequest(req: Request) {
    const { pathname } = req.parsed;

    return this.webSocketRoutes.find((r) => this.routeMatches(r, pathname));
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    this.httpRoutes = [];
    this.webSocketRoutes = [];
    return await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
