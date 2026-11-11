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
   * Check credentials by default so two-argument SDK wrappers are safe before
   * input preparation. Explicit policy checks require validated input.
   */
  public async isAuthorized(
    req: Request,
    route: AuthRoute,
    stage: 'credentials' | 'policy' = 'credentials',
  ): Promise<boolean> {
    const strict = this.requiresStrictAuth(route);
    if (this.config.getToken() === null || (!strict && route.auth === false)) {
      return true;
    }
    if (!(await this.isTokenValid(req))) {
      return false;
    }
    if (stage === 'policy' && !strict && typeof route.auth === 'function') {
      return this.isPolicyAuthorized(req, route);
    }

    return true;
  }

  /** Return admission now, or a policy to run after input validation. */
  public async authorizeRoute(
    req: Request,
    route: AuthRoute,
  ): Promise<boolean | (() => Promise<boolean>)> {
    const strict = this.requiresStrictAuth(route);
    if (!strict && route.auth === false) return true;
    if (!(await this.isAuthorized(req, route))) return false;
    if (
      this.config.getToken() === null ||
      strict ||
      typeof route.auth !== 'function'
    ) {
      return true;
    }
    return () => this.isPolicyAuthorized(req, route);
  }

  protected async isPolicyAuthorized(
    req: Request,
    route: AuthRoute,
  ): Promise<boolean> {
    if (typeof route.auth !== 'function') return true;
    try {
      if ((await route.auth(req)) === true) return true;
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
    this.logger.trace('Route authorization denied in policy pass', route.name);
    return false;
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
