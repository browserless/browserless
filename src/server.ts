import * as http from 'http';
import * as stream from 'stream';
import {
  BadRequest,
  BrowserHTTPRoute,
  BrowserManager,
  BrowserWebsocketRoute,
  Config,
  HTTPManagementRoutes,
  HTTPRoute,
  Limiter,
  Methods,
  Metrics,
  NotFound,
  Request,
  Response,
  Timeout,
  TooManyRequests,
  Unauthorized,
  WebSocketRoute,
  beforeRequest,
  contentTypes,
  convertPathToURL,
  createLogger,
  isAuthorized,
  isConnected,
  queryParamsToObject,
  readBody,
  shimLegacyRequests,
  writeResponse,
} from '@browserless.io/browserless';

// @ts-ignore
import Enjoi from 'enjoi';
import micromatch from 'micromatch';

const debug = createLogger('server');
const verbose = createLogger('server:verbose');

export interface HTTPServerOptions {
  concurrent: number;
  host: string;
  port: string;
  queued: number;
  timeout: number;
}

export class HTTPServer {
  private server: http.Server = http.createServer();
  private port: number;
  private host?: string;

  constructor(
    private config: Config,
    private metrics: Metrics,
    private browserManager: BrowserManager,
    private limiter: Limiter,
    private httpRoutes: Array<HTTPRoute | BrowserHTTPRoute>,
    private webSocketRoutes: Array<WebSocketRoute | BrowserWebsocketRoute>,
  ) {
    this.host = config.getHost();
    this.port = config.getPort();
    this.httpRoutes = httpRoutes.map((r) => this.registerHTTPRoute(r));
    this.webSocketRoutes = webSocketRoutes.map((r) =>
      this.registerWebSocketRoute(r),
    );

    debug(
      `Server instantiated with host "${this.host}" on port "${
        this.port
      }" using token "${this.config.getToken()}"`,
    );
  }

  private onQueueFullHTTP = (_req: Request, res: Response) => {
    debug(`Queue is full, sending 429 response`);
    return writeResponse(res, 429, 'Too many requests');
  };

  private onQueueFullWebSocket = (_req: Request, socket: stream.Duplex) => {
    debug(`Queue is full, sending 429 response`);
    return writeResponse(socket, 429, 'Too many requests');
  };

  private onHTTPTimeout = (_req: Request, res: Response) => {
    debug(`HTTP job has timedout, sending 429 response`);
    return writeResponse(res, 408, 'Request has timed out');
  };

  private onWebsocketTimeout = (_req: Request, socket: stream.Duplex) => {
    debug(`Websocket job has timedout, sending 429 response`);
    return writeResponse(socket, 408, 'Request has timed out');
  };

  private onHTTPUnauthorized = (_req: Request, res: Response) => {
    debug(`HTTP request is not properly authorized, responding with 401`);
    this.metrics.addUnauthorized();
    return writeResponse(res, 401, 'Bad or missing authentication.');
  };

  private onWebsocketUnauthorized = (_req: Request, socket: stream.Duplex) => {
    debug(`Websocket request is not properly authorized, responding with 401`);
    this.metrics.addUnauthorized();
    return writeResponse(socket, 401, 'Bad or missing authentication.');
  };

  private wrapHTTPHandler =
    (
      route: HTTPRoute | BrowserHTTPRoute,
      handler: HTTPRoute['handler'] | BrowserHTTPRoute['handler'],
    ) =>
    async (req: Request, res: Response) => {
      if (!isConnected(res)) {
        debug(`HTTP Request has closed prior to running`);
        return Promise.resolve();
      }

      if (route.browser) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
        );

        if (!isConnected(res)) {
          debug(`HTTP Request has closed prior to running`);
          this.browserManager.complete(browser);
          return Promise.resolve();
        }

        if (!browser) {
          return writeResponse(res, 500, `Error loading the browser.`);
        }

        if (!isConnected(res)) {
          debug(`HTTP Request has closed prior to running`);
          return Promise.resolve();
        }

        try {
          verbose(`Running found HTTP handler.`);
          return await handler(req, res, browser);
        } finally {
          verbose(`HTTP Request handler has finished.`);
          this.browserManager.complete(browser);
        }
      }

      return (handler as HTTPRoute['handler'])(req, res);
    };

  private wrapWebSocketHandler =
    (
      route: WebSocketRoute | BrowserWebsocketRoute,
      handler: WebSocketRoute['handler'] | BrowserWebsocketRoute['handler'],
    ) =>
    async (req: Request, socket: stream.Duplex, head: Buffer) => {
      if (!isConnected(socket)) {
        debug(`WebSocket Request has closed prior to running`);
        return Promise.resolve();
      }

      if (route.browser) {
        const browser = await this.browserManager.getBrowserForRequest(
          req,
          route,
        );

        if (!isConnected(socket)) {
          debug(`WebSocket Request has closed prior to running`);
          this.browserManager.complete(browser);
          return Promise.resolve();
        }

        if (!browser) {
          return writeResponse(socket, 500, `Error loading the browser.`);
        }

        try {
          verbose(`Running found WebSocket handler.`);
          await handler(req, socket, head, browser);
        } finally {
          verbose(`WebSocket Request handler has finished.`);
          this.browserManager.complete(browser);
        }
        return;
      }
      return (handler as WebSocketRoute['handler'])(req, socket, head);
    };

  private getTimeout(req: Request) {
    const timer = req.parsed.searchParams.get('timeout');

    return timer ? +timer : undefined;
  }

  private registerHTTPRoute(
    route: HTTPRoute | BrowserHTTPRoute,
  ): HTTPRoute | BrowserHTTPRoute {
    verbose(`Registering HTTP ${route.method.toUpperCase()} ${route.path}`);

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

    return route;
  }

  private registerWebSocketRoute(
    route: WebSocketRoute | BrowserWebsocketRoute,
  ): WebSocketRoute | BrowserWebsocketRoute {
    verbose(`Registering WebSocket "${route.path}"`);

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

    return route;
  }

  public async start(): Promise<void> {
    debug(`HTTP Server is starting`);

    this.server.on('request', this.handleRequest);
    this.server.on('upgrade', this.handleWebSocket);
    const listenMessage = [
      `HTTP Server is listening on ${this.config.getServerAddress()}`,
      `Use ${this.config.getExternalAddress()} for API and connect calls`,
    ].join('\n');

    return new Promise((r) => {
      this.server.listen(
        {
          host: this.host,
          port: this.port,
        },
        undefined,
        () => {
          debug(listenMessage);
          r(undefined);
        },
      );
    });
  }

  public async stop(): Promise<void> {
    debug(`HTTP Server is shutting down`);
    await new Promise((r) => this.server.close(r));
    await Promise.all([this.tearDown(), this.browserManager.stop()]);
    debug(`HTTP Server shutdown complete`);
  }

  private tearDown() {
    debug(`Tearing down all listeners and internal routes`);
    this.server && this.server.removeAllListeners();
    this.httpRoutes = [];
    this.webSocketRoutes = [];

    // @ts-ignore garbage collect this reference
    this.server = null;
  }

  private handleRequest = async (
    request: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    verbose(
      `Handling inbound HTTP request on "${request.method}: ${request.url}"`,
    );

    const req = request as Request;
    const proceed = await beforeRequest({ req, res });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

    const staticHandler = this.httpRoutes.find(
      (route) => route.path === HTTPManagementRoutes.static,
    ) as HTTPRoute;

    if (this.config.getAllowCORS()) {
      Object.entries(this.config.getCORSHeaders()).forEach(([header, value]) =>
        res.setHeader(header, value),
      );

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    if (
      this.config.getAllowGetCalls() &&
      req.method === 'GET' &&
      req.parsed.searchParams.has('body')
    ) {
      req.headers['content-type'] = contentTypes.json;
      req.method = 'post';
      req.body = req.parsed.searchParams.get('body');
      req.parsed.searchParams.delete('body');
    }

    const accepts = (req.headers['accept']?.toLowerCase() || '*/*').split(',');
    const contentType = req.headers['content-type']?.toLowerCase() as
      | contentTypes
      | undefined;

    const found =
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
      ) || (req.method?.toLowerCase() === 'get' ? staticHandler : null);

    if (!found) {
      debug(`No matching WebSocket route handler for "${req.parsed.href}"`);
      writeResponse(res, 404, 'Not Found');
      return Promise.resolve();
    }

    verbose(`Found matching HTTP route handler "${found.path}"`);

    if (found?.auth) {
      verbose(`Authorizing HTTP request to "${request.url}"`);
      const tokens = this.config.getToken();
      const isPermitted = isAuthorized(req, found, tokens);

      if (!isPermitted) {
        return this.onHTTPUnauthorized(req, res);
      }
    }

    const body = await readBody(req);
    req.body = body;
    req.queryParams = queryParamsToObject(req.parsed.searchParams);

    if (
      ((req.headers['content-type']?.includes(contentTypes.json) ||
        (found.accepts.length === 1 &&
          found.accepts.includes(contentTypes.json))) &&
        typeof body !== 'object') ||
      body === null
    ) {
      writeResponse(res, 400, `Couldn't parse JSON body`);
      return Promise.resolve();
    }

    if (found.querySchema) {
      verbose(`Validating route query-params with QUERY schema`);
      try {
        const schema = Enjoi.schema(found.querySchema);
        const valid = schema.validate(req.queryParams, {
          abortEarly: false,
        });

        if (valid.error) {
          const errorDetails = valid.error.details
            .map(
              ({
                message,
                context,
              }: {
                context?: { message: string };
                message: string;
              }) => context?.message || message,
            )
            .join('\n');

          debug(`HTTP query-params contain errors sending 400:${errorDetails}`);

          writeResponse(
            res,
            400,
            `Query-parameter validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
      } catch (e) {
        debug(`Error parsing body schema`, e);
        writeResponse(
          res,
          500,
          'There was an error handling your request',
          contentTypes.text,
        );
        return Promise.resolve();
      }
    }

    if (found.bodySchema) {
      verbose(`Validating route payload with BODY schema`);
      try {
        const schema = Enjoi.schema(found.bodySchema);
        const valid = schema.validate(body, { abortEarly: false });

        if (valid.error) {
          const errorDetails = valid.error.details
            .map(
              ({
                message,
                context,
              }: {
                context?: { message: string };
                message: string;
              }) => context?.message || message,
            )
            .join('\n');

          debug(`HTTP body contain errors sending 400:${errorDetails}`);

          writeResponse(
            res,
            400,
            `POST Body validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
      } catch (e) {
        debug(`Error parsing body schema`, e);
        writeResponse(
          res,
          500,
          'There was an error handling your request',
          contentTypes.text,
        );
        return Promise.resolve();
      }
    }

    // #wrapHTTPHandler will take care of applying the extra browser
    // argument for this to to work properly
    return (found as HTTPRoute)
      .handler(req, res)
      .then(() => {
        verbose('HTTP connection complete');
      })
      .catch((e) => {
        if (e instanceof BadRequest) {
          return writeResponse(res, 400, e.message);
        }

        if (e instanceof NotFound) {
          return writeResponse(res, 404, e.message);
        }

        if (e instanceof Unauthorized) {
          return writeResponse(res, 401, e.message);
        }

        if (e instanceof TooManyRequests) {
          return writeResponse(res, 429, e.message);
        }

        if (e instanceof Timeout) {
          return writeResponse(res, 408, e.message);
        }

        debug(`Error handling request at "${found.path}": ${e}`);
        return writeResponse(res, 500, e.toString());
      });
  };

  private handleWebSocket = async (
    request: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ) => {
    verbose(`Handling inbound WebSocket request on "${request.url}"`);

    const req = request as Request;
    const proceed = await beforeRequest({ head, req, socket });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

    const { pathname } = req.parsed;
    req.queryParams = queryParamsToObject(req.parsed.searchParams);

    const found = this.webSocketRoutes.find((r) =>
      micromatch.isMatch(pathname, r.path),
    );

    if (found) {
      verbose(`Found matching WebSocket route handler "${found.path}"`);

      if (found?.auth) {
        verbose(`Authorizing WebSocket request to "${req.parsed.href}"`);
        const isPermitted = isAuthorized(req, found, this.config.getToken());

        if (!isPermitted) {
          return this.onWebsocketUnauthorized(req, socket);
        }
      }

      if (found.querySchema) {
        verbose(`Validating route query-params with QUERY schema`);
        try {
          const schema = Enjoi.schema(found.querySchema);
          const valid = schema.validate(req.queryParams, {
            abortEarly: false,
          });

          if (valid.error) {
            const errorDetails = valid.error.details
              .map(
                ({
                  message,
                  context,
                }: {
                  context?: { message: string };
                  message: string;
                }) => context?.message || message,
              )
              .join('\n');

            debug(
              `WebSocket query-params contain errors sending 400:${errorDetails}`,
            );

            writeResponse(
              socket,
              400,
              `Query-parameter validation failed: ${errorDetails}`,
              contentTypes.text,
            );
            return Promise.resolve();
          }
        } catch (e) {
          debug(`Error parsing query-params schema`, e);
          writeResponse(
            socket,
            500,
            'There was an error handling your request',
            contentTypes.text,
          );
          return Promise.resolve();
        }
      }

      // #wrapWebSocketHandler will take care of applying the extra browser
      // argument for this to to work properly
      return (found as WebSocketRoute)
        .handler(req, socket, head)
        .then(() => {
          verbose('Websocket connection complete');
        })
        .catch((e) => {
          if (e instanceof BadRequest) {
            return writeResponse(socket, 400, e.message);
          }

          if (e instanceof NotFound) {
            return writeResponse(socket, 404, e.message);
          }

          if (e instanceof Unauthorized) {
            return writeResponse(socket, 401, e.message);
          }

          if (e instanceof TooManyRequests) {
            return writeResponse(socket, 429, e.message);
          }

          debug(`Error handling request at "${found.path}": ${e}\n${e.stack}`);

          return writeResponse(socket, 500, e.message);
        });
    }

    debug(`No matching WebSocket route handler for "${req.parsed.href}"`);
    return writeResponse(socket, 404, 'Not Found');
  };
}
