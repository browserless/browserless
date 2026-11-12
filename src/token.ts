import {
  BrowserHTTPRoute,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  Config,
  Forbidden,
  HTTPRoute,
  Logger,
  Request,
  WebSocketRoute,
  getTokenFromRequest,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';

type AuthRoute =
  BrowserHTTPRoute | BrowserWebsocketRoute | HTTPRoute | WebSocketRoute;

export class Token extends EventEmitter {
  protected logger = new Logger('token');

  constructor(protected config: Config) {
    super();
  }

  /**
   * Checks the request's credentials. Override it to accept additional keys:
   * unlike an isAuthorized override, it also covers the credential check that
   * routes with `strictAuthPolicy` run before reading input.
   */
  public async isTokenValid(req: Request): Promise<boolean> {
    const token = this.config.getToken();
    const requestToken = getTokenFromRequest(req);
    return (
      token === null ||
      (!!requestToken &&
        (Array.isArray(token) ? token : [token]).includes(requestToken))
    );
  }

  /** Whether this route needs authorization, including SDK strict overrides. */
  public requiresAuth(route: AuthRoute): boolean {
    return route.auth !== false || this.requiresStrictAuth(route);
  }

  /**
   * Whether a function-valued `auth` decides access to this route. The server
   * then authorizes after validating input, so the policy sees validated
   * query parameters and body.
   */
  public usesAuthPolicy(route: AuthRoute): boolean {
    return typeof route.auth === 'function' && !this.requiresStrictAuth(route);
  }

  /**
   * Returns false (401) for requests that lack required credentials. Only a
   * `strictAuthPolicy` denial throws Forbidden (403).
   */
  public async isAuthorized(req: Request, route: AuthRoute): Promise<boolean> {
    if (this.config.getToken() === null || !this.requiresAuth(route)) {
      return true;
    }
    const validToken = await this.isTokenValid(req);
    if (!this.usesAuthPolicy(route) || typeof route.auth !== 'function') {
      return validToken;
    }
    // A default policy says whether the request needs credentials, so valid
    // ones always pass. A strict policy needs them and must also return true.
    if (validToken && !route.strictAuthPolicy) return true;
    if (!validToken && route.strictAuthPolicy) return false;
    let result: unknown;
    try {
      result = await route.auth(req);
    } catch (error) {
      // Error names and messages can contain request data; log only safe types.
      this.logger.warn(
        'Route authentication policy failed for route',
        route.name,
      );
      this.logger.debug(
        'Route authentication policy error type',
        error instanceof TypeError
          ? 'TypeError'
          : error instanceof Error
            ? 'Error'
            : typeof error,
      );
    }
    // Only an explicit false makes a default policy's request public; errors
    // and other results require credentials.
    if (!route.strictAuthPolicy) return result === false;
    if (result === true) return true;
    this.logger.trace('Route authorization denied in policy pass', route.name);
    throw new Forbidden('Forbidden');
  }

  /**
   * STRICT_TOKEN_USE forces the token onto every route, overriding any `auth`
   * value it sets (false or a function).
   * Static files stay public: they grant no browser access, and the debugger
   * and DevTools frontend load their sub-resources without a token.
   */
  protected requiresStrictAuth(route: AuthRoute): boolean {
    return (
      this.config.getStrictTokenUse() &&
      route.name !== BrowserlessRoutes.StaticGetRoute
    );
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    return await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
