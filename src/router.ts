import {
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  Config,
  HTTPManagementRoutes,
  HTTPRoute,
  Limiter,
  Methods,
  Request,
  Response,
  WebSocketRoute,
  contentTypes,
  createLogger,
  isConnected,
  writeResponse,
} from '@browserless.io/browserless';
import micromatch from 'micromatch';
import stream from 'stream';

export class Router {
  protected log = createLogger('router');
  protected verbose = createLogger('router:verbose');
  protected httpRoutes: Array<HTTPRoute | BrowserHTTPRoute> = [];
  protected webSocketRoutes: Array<WebSocketRoute | BrowserWebsocketRoute> = [];

  constructor(
    protected config: Config,
    protected browserManager: BrowserManager,
    protected limiter: Limiter,
  ) {}

  protected getTimeout(req: Request) {
    const timer = req.parsed.searchParams.get('timeout');

    return timer ? +timer : undefined;
  }

  protected onQueueFullHTTP = (_req: Request, res: Response) => {
    this.log(`Queue is full, sending 429 response`);
    return writeResponse(res, 429, 'Too many requests');
  };

  protected onQueueFullWebSocket = (_req: Request, socket: stream.Duplex) => {
    this.log(`Queue is full, sending 429 response`);
    return writeResponse(socket, 429, 'Too many requests');
  };

  protected onHTTPTimeout = (_req: Request, res: Response) => {
    this.log(`HTTP job has timedout, sending 429 response`);
    return writeResponse(res, 408, 'Request has timed out');
  };

  protected onWebsocketTimeout = (_req: Request, socket: stream.Duplex) => {
    this.log(`Websocket job has timedout, sending 429 response`);
    return writeResponse(socket, 408, 'Request has timed out');
  };

  protected wrapHTTPHandler =
    (
      route: HTTPRoute | BrowserHTTPRoute,
      handler: HTTPRoute['handler'] | BrowserHTTPRoute['handler'],
    ) =>
    async (req: Request, res: Response) => {
      if (!isConnected(res)) {
        this.log(`HTTP Request has closed prior to running`);
        return Promise.resolve();
      }

      if (route.browser) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
        );

        if (!isConnected(res)) {
          this.log(`HTTP Request has closed prior to running`);
          this.browserManager.complete(browser);
          return Promise.resolve();
        }

        if (!browser) {
          return writeResponse(res, 500, `Error loading the browser.`);
        }

        if (!isConnected(res)) {
          this.log(`HTTP Request has closed prior to running`);
          return Promise.resolve();
        }

        try {
          this.verbose(`Running found HTTP handler.`);
          return await handler(req, res, browser);
        } finally {
          this.verbose(`HTTP Request handler has finished.`);
          this.browserManager.complete(browser);
        }
      }

      return (handler as HTTPRoute['handler'])(req, res);
    };

  protected wrapWebSocketHandler =
    (
      route: WebSocketRoute | BrowserWebsocketRoute,
      handler: WebSocketRoute['handler'] | BrowserWebsocketRoute['handler'],
    ) =>
    async (req: Request, socket: stream.Duplex, head: Buffer) => {
      if (!isConnected(socket)) {
        this.log(`WebSocket Request has closed prior to running`);
        return Promise.resolve();
      }

      if (route.browser) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
        );

        if (!isConnected(socket)) {
          this.log(`WebSocket Request has closed prior to running`);
          this.browserManager.complete(browser);
          return Promise.resolve();
        }

        if (!browser) {
          return writeResponse(socket, 500, `Error loading the browser.`);
        }

        try {
          this.verbose(`Running found WebSocket handler.`);
          await handler(req, socket, head, browser);
        } finally {
          this.verbose(`WebSocket Request handler has finished.`);
          this.browserManager.complete(browser);
        }
        return;
      }
      return (handler as WebSocketRoute['handler'])(req, socket, head);
    };

  public registerHTTPRoute(
    route: HTTPRoute | BrowserHTTPRoute,
  ): HTTPRoute | BrowserHTTPRoute {
    this.verbose(
      `Registering HTTP ${route.method.toUpperCase()} ${route.path}`,
    );

    route._browserManager = () => this.browserManager;

    const bound = route.handler.bind(route);
    const wrapped = this.wrapHTTPHandler(route, bound);

    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullHTTP,
          this.onHTTPTimeout,
          this.getTimeout,
        )
      : wrapped;

    this.httpRoutes.push(route);

    return route;
  }

  public registerWebSocketRoute(
    route: WebSocketRoute | BrowserWebsocketRoute,
  ): WebSocketRoute | BrowserWebsocketRoute {
    this.verbose(`Registering WebSocket "${route.path}"`);

    route._browserManager = () => this.browserManager;

    const bound = route.handler.bind(route);
    const wrapped = this.wrapWebSocketHandler(route, bound);

    route.handler = route.concurrency
      ? this.limiter.limit(
          wrapped,
          this.onQueueFullWebSocket,
          this.onWebsocketTimeout,
          this.getTimeout,
        )
      : wrapped;

    this.webSocketRoutes.push(route);

    return route;
  }

  public teardown() {
    this.httpRoutes = [];
    this.webSocketRoutes = [];

    return this.browserManager.stop();
  }

  public getStaticHandler() {
    return this.httpRoutes.find(
      (route) => route.path === HTTPManagementRoutes.static,
    ) as HTTPRoute;
  }

  public getRouteForHTTPRequest(req: Request) {
    const accepts = (req.headers['accept']?.toLowerCase() || '*/*').split(',');
    const contentType = req.headers['content-type']?.toLowerCase() as
      | contentTypes
      | undefined;

    return (
      this.httpRoutes.find(
        (r) =>
          micromatch.isMatch(req.parsed.pathname, r.path) &&
          r.method === (req.method?.toLocaleLowerCase() as Methods) &&
          (accepts.some((a) => a.startsWith('*/*')) ||
            r.contentTypes.some((contentType) =>
              accepts.includes(contentType),
            )) &&
          ((!contentType && r.accepts.includes(contentTypes.any)) ||
            r.accepts.includes(contentType as contentTypes)),
      ) ||
      (req.method?.toLowerCase() === 'get' ? this.getStaticHandler() : null)
    );
  }

  public getRouteForWebSocketRequest(req: Request) {
    const { pathname } = req.parsed;

    return this.webSocketRoutes.find((r) =>
      micromatch.isMatch(pathname, r.path),
    );
  }
}
