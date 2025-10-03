import * as http from 'http';
import * as stream from 'stream';
import {
  BadRequest,
  Logger as BlessLogger,
  Config,
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

import EnjoiResolver from './shared/utils/enjoi-resolver.js';

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

  protected handleErrorRequest(e: Error, res: Response | stream.Duplex) {
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

    this.logger.error(`Error handling request: ${e}\n${e.stack}`);

    return writeResponse(res, 500, e.toString());
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

    this.server.on('request', this.handleRequest.bind(this));
    this.server.on('upgrade', this.handleWebSocket.bind(this));

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

  protected async handleRequest(
    request: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    request.url = moveTokenToHeader(request);
    this.logger.trace(
      `Handling inbound HTTP request on "${request.method}: ${request.url || ''}"`,
    );

    const req = request as Request;
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
      this.logger.error(
        `No matching HTTP route handler for "${req.method}: ${req.parsed.href}"`,
      );
      writeResponse(res, 404, 'Not Found');
      return Promise.resolve();
    }

    this.logger.trace(`Found matching HTTP route handler "${route.path}"`);

    if (route.before && !(await route.before(req, res))) {
      return;
    }

    if (route?.auth) {
      this.logger.trace(`Authorizing HTTP request to "${request.url || ''}"`);
      const isPermitted = await this.token.isAuthorized(req, route);

      if (!isPermitted) {
        return this.onHTTPUnauthorized(req, res);
      }
    }

    const body = await readBody(req, this.config.getMaxPayloadSize()).catch(
      (e) => this.handleErrorRequest(e, res),
    );
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
        const schema = EnjoiResolver.schema(route.querySchema);
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
        const schema = EnjoiResolver.schema(route.bodySchema);
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

          this.logger.error(
            `HTTP body contain errors sending 400:${errorDetails}`,
          );

          writeResponse(
            res,
            400,
            `POST Body validation failed: ${errorDetails}`,
            contentTypes.text,
          );
          return Promise.resolve();
        }
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
      .catch((e) => this.handleErrorRequest(e, res));
  }

  protected async handleWebSocket(
    request: http.IncomingMessage,
    socket: stream.Duplex,
    head: Buffer,
  ) {
    request.url = moveTokenToHeader(request);

    this.logger.trace(
      `Handling inbound WebSocket request on "${request.url || ''}"`,
    );

    const req = request as Request;
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

      if (route?.auth) {
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
          const schema = EnjoiResolver.schema(route.querySchema);
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

            this.logger.error(
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
        .catch((e) => this.handleErrorRequest(e, socket));
    }

    this.logger.error(
      `No matching WebSocket route handler for "${req.parsed.href}"`,
    );
    return writeResponse(socket, 404, 'Not Found');
  }

  public async shutdown(): Promise<void> {
    this.logger.info(`HTTP Server is shutting down`);
    await new Promise((r) => this.server?.close(r));

    if (this.server) {
      this.server.removeAllListeners();
    }

    // @ts-ignore garbage collect this reference
    this.server = null;
    this.logger.info(`HTTP Server shutdown complete`);
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
