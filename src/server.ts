import * as http from 'http';
import * as stream from 'stream';
import {
  BadRequest,
  Config,
  HTTPRoute,
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
  beforeRequest,
  contentTypes,
  convertPathToURL,
  createLogger,
  queryParamsToObject,
  readBody,
  shimLegacyRequests,
  writeResponse,
} from '@browserless.io/browserless';

// @ts-ignore
import Enjoi from 'enjoi';

export interface HTTPServerOptions {
  concurrent: number;
  host: string;
  port: string;
  queued: number;
  timeout: number;
}

export class HTTPServer {
  protected server: http.Server = http.createServer();
  protected port: number;
  protected host?: string;
  protected log = createLogger('server');
  protected verbose = createLogger('server:verbose');

  constructor(
    protected config: Config,
    protected metrics: Metrics,
    protected token: Token,
    protected router: Router,
  ) {
    this.host = config.getHost();
    this.port = config.getPort();

    this.log(
      `Server instantiated with host "${this.host}" on port "${
        this.port
      }" using token "${this.config.getToken()}"`,
    );
  }

  protected onHTTPUnauthorized = (_req: Request, res: Response) => {
    this.log(`HTTP request is not properly authorized, responding with 401`);
    this.metrics.addUnauthorized();
    return writeResponse(res, 401, 'Bad or missing authentication.');
  };

  protected onWebsocketUnauthorized = (
    _req: Request,
    socket: stream.Duplex,
  ) => {
    this.log(
      `Websocket request is not properly authorized, responding with 401`,
    );
    this.metrics.addUnauthorized();
    return writeResponse(socket, 401, 'Bad or missing authentication.');
  };

  public async start(): Promise<void> {
    this.log(`HTTP Server is starting`);

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
          this.log(listenMessage);
          r(undefined);
        },
      );
    });
  }

  public async stop(): Promise<void> {
    this.log(`HTTP Server is shutting down`);
    await new Promise((r) => this.server.close(r));
    await Promise.all([this.tearDown(), this.router.teardown()]);
    this.log(`HTTP Server shutdown complete`);
  }

  protected tearDown() {
    this.log(`Tearing down all listeners and internal routes`);
    this.server && this.server.removeAllListeners();

    // @ts-ignore garbage collect this reference
    this.server = null;
  }

  protected handleRequest = async (
    request: http.IncomingMessage,
    res: http.ServerResponse,
  ) => {
    this.verbose(
      `Handling inbound HTTP request on "${request.method}: ${request.url}"`,
    );

    const req = request as Request;
    const proceed = await beforeRequest({ req, res });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

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

    const route = await this.router.getRouteForHTTPRequest(req);

    if (!route) {
      this.log(`No matching WebSocket route handler for "${req.parsed.href}"`);
      writeResponse(res, 404, 'Not Found');
      return Promise.resolve();
    }

    this.verbose(`Found matching HTTP route handler "${route.path}"`);

    if (route?.auth) {
      this.verbose(`Authorizing HTTP request to "${request.url}"`);
      const isPermitted = await this.token.isAuthorized(req, route);

      if (!isPermitted) {
        return this.onHTTPUnauthorized(req, res);
      }
    }

    const body = await readBody(req);
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
      this.verbose(`Validating route query-params with QUERY schema`);
      try {
        const schema = Enjoi.schema(route.querySchema);
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

          this.log(
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
      } catch (e) {
        this.log(`Error parsing body schema`, e);
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
      this.verbose(`Validating route payload with BODY schema`);
      try {
        const schema = Enjoi.schema(route.bodySchema);
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

          this.log(`HTTP body contain errors sending 400:${errorDetails}`);

          writeResponse(
            res,
            400,
            `POST Body validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
      } catch (e) {
        this.log(`Error parsing body schema`, e);
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
      .handler(req, res)
      .then(() => {
        this.verbose('HTTP connection complete');
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

        this.log(`Error handling request at "${route.path}": ${e}`);
        return writeResponse(res, 500, e.toString());
      });
  };

  protected handleWebSocket = async (
    request: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ) => {
    this.verbose(`Handling inbound WebSocket request on "${request.url}"`);

    const req = request as Request;
    const proceed = await beforeRequest({ head, req, socket });
    req.parsed = convertPathToURL(request.url || '', this.config);
    shimLegacyRequests(req.parsed);

    if (!proceed) return;

    req.queryParams = queryParamsToObject(req.parsed.searchParams);

    const route = await this.router.getRouteForWebSocketRequest(req);

    if (route) {
      this.verbose(`Found matching WebSocket route handler "${route.path}"`);

      if (route?.auth) {
        this.verbose(`Authorizing WebSocket request to "${req.parsed.href}"`);
        const isPermitted = await this.token.isAuthorized(req, route);

        if (!isPermitted) {
          return this.onWebsocketUnauthorized(req, socket);
        }
      }

      if (route.querySchema) {
        this.verbose(`Validating route query-params with QUERY schema`);
        try {
          const schema = Enjoi.schema(route.querySchema);
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

            this.log(
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
          this.log(`Error parsing query-params schema`, e);
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
        .handler(req, socket, head)
        .then(() => {
          this.verbose('Websocket connection complete');
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

          this.log(
            `Error handling request at "${route.path}": ${e}\n${e.stack}`,
          );

          return writeResponse(socket, 500, e.message);
        });
    }

    this.log(`No matching WebSocket route handler for "${req.parsed.href}"`);
    return writeResponse(socket, 404, 'Not Found');
  };
}
