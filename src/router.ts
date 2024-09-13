import {
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  Config,
  HTTPManagementRoutes,
  HTTPRoute,
  Limiter,
  Logger,
  Methods,
  PathTypes,
  Request,
  Response,
  WebSocketRoute,
  contentTypes,
  isConnected,
  writeResponse,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import micromatch from 'micromatch';
import stream from 'stream';

export class Router extends EventEmitter {
  protected log = new Logger('router');
  protected httpRoutes: Array<HTTPRoute | BrowserHTTPRoute> = [];
  protected webSocketRoutes: Array<WebSocketRoute | BrowserWebsocketRoute> = [];

  constructor(
    protected config: Config,
    protected browserManager: BrowserManager,
    protected limiter: Limiter,
    protected logger: typeof Logger,
  ) {
    super();
  }

  protected getTimeout(req: Request) {
    const timer = req.parsed.searchParams.get('timeout');

    return timer ? +timer : undefined;
  }

  protected onQueueFullHTTP(_req: Request, res: Response) {
    this.log.warn(`Queue is full, sending 429 response`);
    return writeResponse(res, 429, 'Too many requests');
  }

  protected onQueueFullWebSocket(_req: Request, socket: stream.Duplex) {
    this.log.warn(`Queue is full, sending 429 response`);
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

  protected wrapHTTPHandler(
    route: HTTPRoute | BrowserHTTPRoute,
    handler: HTTPRoute['handler'] | BrowserHTTPRoute['handler'],
  ) {
    return async (req: Request, res: Response) => {
      if (!isConnected(res)) {
        this.log.warn(`HTTP Request has closed prior to running`);
        return Promise.resolve();
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
          return Promise.resolve();
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
        return Promise.resolve();
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
          return Promise.resolve();
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

    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullHTTP.bind(this),
          this.onHTTPTimeout.bind(this),
          this.getTimeout.bind(this),
        )
      : wrapped;
    route.path = Array.isArray(route.path) ? route.path : [route.path];
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

    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullWebSocket.bind(this),
          this.onWebsocketTimeout.bind(this),
          this.getTimeout.bind(this),
        )
      : wrapped;
    route.path = Array.isArray(route.path) ? route.path : [route.path];
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
          // Once registered, paths are always an array here.
          (r.path as Array<PathTypes>).some((p) =>
            micromatch.isMatch(req.parsed.pathname, p),
          ) &&
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

    return this.webSocketRoutes.find((r) =>
      // Once registered, paths are always an array here.
      (r.path as Array<PathTypes>).some((p) => micromatch.isMatch(pathname, p)),
    );
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
