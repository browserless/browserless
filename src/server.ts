import * as http from 'http';
import * as net from 'net';
import * as stream from 'stream';
import {
  BadRequest,
  Logger as BlessLogger,
  Config,
  Forbidden,
  HTTPRoute,
  Hooks,
  Metrics,
  NotFound,
  Request,
  Response,
  Router,
  Timeout,
  Token,
  TooManyRequests,
  Unauthorized,
  WebSocketRoute,
  WorkerLifecycle,
  WorkerWithdrawn,
  contentTypes,
  convertPathToURL,
  isMatch,
  moveTokenToHeader,
  queryParamsToObject,
  readBody,
  shimLegacyRequests,
  writeResponse,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';

import { compileSchema } from './shared/utils/schema-validator.js';

export interface HTTPServerOptions {
  concurrent: number;
  host: string;
  port: string;
  queued: number;
  timeout: number;
}

export class HTTPServer extends EventEmitter {
  protected server: http.Server = http.createServer();
  protected port: number;
  protected host?: string;
  protected logger = new BlessLogger('server');
  protected lifecycle = new WorkerLifecycle();
  protected acceptingStopped = false;
  protected liveResponses = new Set<http.ServerResponse>();
  protected httpSockets = new Set<net.Socket>();
  #originalCloseIdleConnections?: http.Server['closeIdleConnections'];

  constructor(
    protected config: Config,
    protected metrics: Metrics,
    protected token: Token,
    protected router: Router,
    protected hooks: Hooks,
    protected Logger: typeof BlessLogger,
  ) {
    super();
    this.host = config.getHost();
    this.port = config.getPort();

    this.logger.info(
      `Server instantiated with host "${this.host}" on port "${this.port}`,
    );
  }

  public setLifecycle(lifecycle: WorkerLifecycle) {
    this.lifecycle = lifecycle;
  }

  /**
   * Count a request from arrival (before hooks.before, auth and body
   * reading) until it is fully handled. Arrivals do not block admission
   * closure, but the shutdown idle barrier waits for them. Requests arriving
   * after closure are counted too; the router refuses non-admitted ones.
   */
  protected trackRequest(req: Request, p: Promise<void>): Promise<void> {
    return this.lifecycle.trackArrival(req, p);
  }

  protected handleErrorRequest(
    e: Error,
    res: Response | stream.Duplex,
    req?: Request,
  ) {
    const contentType = req?.headers['content-type'] as contentTypes;

    if (e instanceof BadRequest) {
      return writeResponse(res, 400, e.message, contentType);
    }

    if (e instanceof NotFound) {
      return writeResponse(res, 404, e.message, contentType);
    }

    if (e instanceof Forbidden) {
      return writeResponse(res, 403, e.message, contentType);
    }

    if (e instanceof Unauthorized) {
      return writeResponse(res, 401, e.message, contentType);
    }

    if (e instanceof TooManyRequests) {
      return writeResponse(res, 429, e.message, contentType);
    }

    if (e instanceof Timeout) {
      return writeResponse(res, 408, e.message, contentType);
    }

    if (e instanceof WorkerWithdrawn) {
      return writeResponse(res, 503, e.message, contentType);
    }

    this.logger.error(`Error handling request: ${e}\n${e.stack}`);

    // Full details are logged above — don't echo internals (paths, stack
    // fragments, library errors) back to the client.
    return writeResponse(res, 500, 'Internal Server Error');
  }

  protected onHTTPUnauthorized(_req: Request, res: Response) {
    this.logger.error(
      `HTTP request is not properly authorized, responding with 401`,
    );
    this.metrics.addUnauthorized();
    return writeResponse(res, 401, 'Bad or missing authentication.');
  }

  protected onWebsocketUnauthorized(_req: Request, socket: stream.Duplex) {
    this.logger.error(
      `Websocket request is not properly authorized, responding with 401`,
    );
    this.metrics.addUnauthorized();
    return writeResponse(socket, 401, 'Bad or missing authentication.');
  }

  public async start(): Promise<void> {
    this.logger.info(`HTTP Server is starting`);

    this.server.on('connection', (socket) => {
      this.httpSockets.add(socket);
      socket.once('close', () => this.httpSockets.delete(socket));
    });
    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('upgrade', this.handleUpgrade.bind(this));

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
          this.logger.info(listenMessage);
          r(undefined);
        },
      );
    });
  }

  protected handleUpgrade(
    request: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ) {
    this.httpSockets.delete(socket as net.Socket);
    if (request.headers.upgrade?.toLowerCase() === 'websocket') {
      return this.handleWebSocket(request, socket, head);
    }

    // Non-WebSocket upgrade (h2c, etc.) — process as normal HTTP
    // per RFC 7230 Section 6.7.
    this.logger.trace(
      `Non-WebSocket upgrade request (Upgrade: ${request.headers.upgrade}), handling as HTTP`,
    );

    socket.on('error', (err) => {
      this.logger.error(
        `Socket error during non-WebSocket upgrade handling: ${err.message}`,
      );
    });

    const res = new http.ServerResponse(request);
    res.assignSocket(socket as unknown as net.Socket);

    res.on('finish', () => {
      res.detachSocket(socket as unknown as net.Socket);
      (socket as unknown as net.Socket).destroySoon();
    });

    return this.handleRequest(request, res);
  }

  protected async handleRequest(
    request: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const req = request as Request;
    if (this.acceptingStopped) {
      res.shouldKeepAlive = false;
    }
    this.liveResponses.add(res);
    const responseFinished = new Promise<void>((resolve) => {
      res.once('close', () => {
        this.liveResponses.delete(res);
        resolve();
      });
      res.once('finish', () => {
        this.liveResponses.delete(res);
        resolve();
        if (this.acceptingStopped) {
          setImmediate(() => this.server?.closeIdleConnections());
        }
      });
    });
    // Any throw out of this method is an unhandled rejection on the
    // 'request' listener, which kills the whole process — catch and map
    // to an error response instead.
    return this.trackRequest(
      req,
      (async () => {
        try {
          await this.handleRequestUnsafe(req, res);
        } catch (e: unknown) {
          this.handleErrorRequest(e as Error, res, req);
        } finally {
          // Handler completion does not imply buffered response bytes flushed.
          await responseFinished;
        }
      })(),
    );
  }

  protected async handleRequestUnsafe(req: Request, res: http.ServerResponse) {
    const request = req as http.IncomingMessage;
    request.url = moveTokenToHeader(request);
    this.logger.trace(
      `Handling inbound HTTP request on "${request.method}: ${request.url || ''}"`,
    );

    const proceed = await this.hooks.before({ req, res });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

    if (this.config.getAllowCORS()) {
      const corsHeaders = this.config.getCORSHeaders();
      const origin = req.headers.origin;

      // If origin matches the Access-Control-Allow-Origin header,
      // set the relevant CORS headers, otherwise return a 404
      if (
        origin &&
        isMatch(origin, corsHeaders['Access-Control-Allow-Origin'])
      ) {
        corsHeaders['Access-Control-Allow-Origin'] = origin;

        Object.entries(corsHeaders).forEach(([header, value]) =>
          res.setHeader(header, value),
        );

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          return res.end();
        }
      }
    }

    if (req.method?.toLowerCase() === 'head') {
      this.logger.debug(`Inbound HEAD request, setting to GET`);
      req.method = 'GET';
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

    const route = await this.router.getRouteForHTTPRequest(req);

    if (!route) {
      this.logger.warn(
        `No matching HTTP route handler for "${req.method}: ${req.parsed.href}"`,
      );
      writeResponse(
        res,
        404,
        'Not Found: Please verify the endpoint URL, the HTTP method (e.g., POST, GET), and check that your Content-Type header is supported (e.g., application/json). See: https://docs.browserless.io/rest-apis/intro',
      );
      return Promise.resolve();
    }

    this.logger.trace(`Found matching HTTP route handler "${route.path}"`);

    if (route.before && !(await route.before(req, res))) {
      return;
    }

    // Under STRICT_TOKEN_USE every route is sent to Token, which owns the
    // per-route exemptions (static files).
    if (route.auth || this.config.getStrictTokenUse()) {
      this.logger.trace(`Authorizing HTTP request to "${request.url || ''}"`);
      const isPermitted = await this.token.isAuthorized(req, route);

      if (!isPermitted) {
        return this.onHTTPUnauthorized(req, res);
      }
    }

    let body;
    try {
      body = await readBody(req, this.config.getMaxPayloadSize());
    } catch (e: unknown) {
      return this.handleErrorRequest(e as Error, res, req);
    }

    req.body = body;
    req.queryParams = queryParamsToObject(req.parsed.searchParams);

    if (
      ((req.headers['content-type']?.includes(contentTypes.json) ||
        (route.accepts.length === 1 &&
          route.accepts.includes(contentTypes.json))) &&
        typeof body !== 'object') ||
      body === null
    ) {
      writeResponse(res, 400, `Couldn't parse JSON body`);
      return Promise.resolve();
    }

    if (route.querySchema) {
      this.logger.trace(`Validating route query-params with QUERY schema`);
      try {
        const schema = compileSchema(route.querySchema);
        const valid = schema.validate(req.queryParams);

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

          this.logger.error(
            `HTTP query-params contain errors sending 400:${errorDetails}`,
          );

          writeResponse(
            res,
            400,
            `Query-parameter validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
        req.queryParams = valid.value as typeof req.queryParams;
      } catch (e) {
        this.logger.error(`Error parsing body schema`, e);
        writeResponse(
          res,
          500,
          'There was an error handling your request',
          contentTypes.text,
        );
        return Promise.resolve();
      }
    }

    if (route.bodySchema) {
      this.logger.trace(`Validating route payload with BODY schema`);
      try {
        const schema = compileSchema(route.bodySchema);
        const valid = schema.validate(body);

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

          // Client error: the request body failed schema validation and we
          // return 400 below with the details. Not operator-actionable, so
          // log at debug rather than warn.
          this.logger.debug(`HTTP body validation failed:${errorDetails}`);

          writeResponse(
            res,
            400,
            `POST Body validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
        body = valid.value;
        req.body = valid.value;
      } catch (e) {
        this.logger.error(`Error parsing body schema`, e);
        writeResponse(
          res,
          500,
          'There was an error handling your request',
          contentTypes.text,
        );
        return Promise.resolve();
      }
    }

    return (route as HTTPRoute)
      .handler(req, res, new this.Logger(route.name, req))
      .then(() => {
        this.logger.trace('HTTP connection complete');
      })
      .catch((e) => this.handleErrorRequest(e, res, req));
  }

  protected async handleWebSocket(
    request: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ) {
    const req = request as Request;

    // A client resetting the connection mid-handshake emits 'error' on the
    // raw socket; with no listener that's an uncaught exception that kills
    // the process.
    socket.on('error', (err) => {
      this.logger.error(`WebSocket socket error: ${err.message}`);
    });

    // Same rationale as handleRequest: a throw here is an unhandled
    // rejection on the 'upgrade' listener and crashes the process.
    return this.trackRequest(
      req,
      (async () => {
        try {
          await this.handleWebSocketUnsafe(req, socket, head);
        } catch (e: unknown) {
          this.handleErrorRequest(e as Error, socket, req);
        }
      })(),
    );
  }

  protected async handleWebSocketUnsafe(
    req: Request,
    socket: stream.Duplex,
    head: Buffer,
  ) {
    const request = req as http.IncomingMessage;
    request.url = moveTokenToHeader(request);

    this.logger.trace(
      `Handling inbound WebSocket request on "${request.url || ''}"`,
    );
    const proceed = await this.hooks.before({ head, req, socket });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

    req.queryParams = queryParamsToObject(req.parsed.searchParams);

    const route = await this.router.getRouteForWebSocketRequest(req);

    if (route) {
      this.logger.trace(
        `Found matching WebSocket route handler "${route.path}"`,
      );

      if (route.before && !(await route.before(req, socket, head))) {
        return;
      }

      // See the HTTP gate above: Token owns the strict-mode exemptions.
      if (route.auth || this.config.getStrictTokenUse()) {
        this.logger.trace(
          `Authorizing WebSocket request to "${req.parsed.href}"`,
        );
        const isPermitted = await this.token.isAuthorized(req, route);

        if (!isPermitted) {
          return this.onWebsocketUnauthorized(req, socket);
        }
      }

      if (route.querySchema) {
        this.logger.trace(`Validating route query-params with QUERY schema`);
        try {
          const schema = compileSchema(route.querySchema);
          const valid = schema.validate(req.queryParams);

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

            this.logger.warn(
              `WebSocket query-params validation failed:${errorDetails}`,
            );

            writeResponse(
              socket,
              400,
              `Query-parameter validation failed: ${errorDetails}`,
              contentTypes.text,
            );
            return Promise.resolve();
          }
          req.queryParams = valid.value as typeof req.queryParams;
        } catch (e) {
          this.logger.error(`Error parsing query-params schema`, e);
          writeResponse(
            socket,
            500,
            'There was an error handling your request',
            contentTypes.text,
          );
          return Promise.resolve();
        }
      }

      return (route as WebSocketRoute)
        .handler(req, socket, head, new this.Logger(route.name, req))
        .then(() => {
          this.logger.trace('Websocket connection complete');
        })
        .catch((e) => this.handleErrorRequest(e, socket, req));
    }

    this.logger.warn(
      `No matching WebSocket route handler for "${req.parsed.href}"`,
    );
    return writeResponse(socket, 404, 'Not Found');
  }

  /**
   * Terminal-stop step: stop accepting connections and close idle keep-alive
   * ones, without waiting for open connections to end (an in-band caller's
   * own connection would never end first). Connections still serving a
   * request are closed once their response finishes. Requests and upgraded
   * sockets already in progress stay counted by the lifecycle. The forced
   * `shutdown()` is unchanged.
   */
  public async stopAccepting(): Promise<void> {
    this.acceptingStopped = true;
    if (!this.server) return;
    // Node's close() also invokes closeIdleConnections(), whose `finished`
    // check can destroy an ended response before its buffered bytes flush.
    // Retain sockets until their responses emit finish/close, and leave
    // upgraded sockets to their normal browser/request ownership.
    this.#originalCloseIdleConnections ??= this.server.closeIdleConnections;
    this.server.closeIdleConnections = () => {
      const busy = new Set([...this.liveResponses].map((res) => res.socket));
      for (const socket of this.httpSockets) {
        if (!busy.has(socket)) socket.destroy();
      }
    };
    // Responses not yet started must not advertise keep-alive.
    for (const res of this.liveResponses) {
      if (!res.headersSent) res.shouldKeepAlive = false;
    }
    if (this.server?.listening) {
      this.server.close();
    }
    this.server?.closeIdleConnections();
  }

  public async shutdown(): Promise<void> {
    if (!this.server) return;
    this.logger.info(`HTTP Server is shutting down`);
    // Forced cleanup must not inherit graceful response-flush protection.
    if (this.#originalCloseIdleConnections) {
      this.server.closeIdleConnections = this.#originalCloseIdleConnections;
      this.#originalCloseIdleConnections = undefined;
    }
    await new Promise((r) => this.server?.close(r));

    if (this.server) {
      this.server.removeAllListeners();
    }

    // @ts-ignore garbage collect this reference
    this.server = null;
    this.logger.info(`HTTP Server shutdown complete`);
  }

  /**
   * Triggers a graceful shutdown of the HTTP server. Downstream SDK modules
   * may override this to implement additional cleanup on shutdown.
   */
  public stop(): void {
    void this.shutdown();
  }
}
