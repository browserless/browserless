import {
  BrowserHTTPRoute,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  Config,
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
   * Override credential validation here to support additional keys without
   * bypassing route policies or changing their input-validation ordering.
   */
  protected async isTokenValid(req: Request): Promise<boolean> {
    const token = this.config.getToken();
    const requestToken = getTokenFromRequest(req);
    return (
      token === null ||
      (!!requestToken &&
        (Array.isArray(token) ? token : [token]).includes(requestToken))
    );
  }

  /**
   * The server first checks credentials before reading input, then evaluates
   * policies with validated input. Direct callers get the full check by default.
   */
  public async isAuthorized(
    req: Request,
    route: AuthRoute,
    stage: 'credentials' | 'policy' = 'policy',
  ): Promise<boolean> {
    const strict = this.requiresStrictAuth(route);
    if (this.config.getToken() === null || (!strict && route.auth === false)) {
      return true;
    }
    if (!(await this.isTokenValid(req))) {
      return false;
    }
    if (stage === 'policy' && !strict && typeof route.auth === 'function') {
      try {
        return (await route.auth(req)) === true;
      } catch {
        // A failed policy must not grant access, even with a valid token.
        this.logger.warn(
          'Route authentication policy failed for route',
          route.name,
        );
        return false;
      }
    }

    return true;
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
