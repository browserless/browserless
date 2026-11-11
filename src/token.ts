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
   * Check credentials before input is read. Only policy evaluation needs the
   * handler's validated input; a policy cannot waive configured credentials.
   */
  public authStage(
    req: Request,
    route: AuthRoute,
  ): 'authorized' | 'denied' | 'policy' {
    const token = this.config.getToken();

    if (token === null) {
      return 'authorized';
    }

    const strict = this.requiresStrictAuth(route);
    if (!strict && route.auth === false) {
      return 'authorized';
    }

    const requestToken = getTokenFromRequest(req);
    if (
      !requestToken ||
      !(Array.isArray(token) ? token : [token]).includes(requestToken)
    ) {
      return 'denied';
    }

    return !strict && typeof route.auth === 'function'
      ? 'policy'
      : 'authorized';
  }

  public async isAuthorized(req: Request, route: AuthRoute): Promise<boolean> {
    const stage = this.authStage(req, route);
    if (stage === 'policy' && typeof route.auth === 'function') {
      try {
        await route.auth(req);
        return true;
      } catch {
        // A failed policy must not grant access, even with a valid token.
        this.logger.warn('Route authentication policy failed');
        return false;
      }
    }

    return stage === 'authorized';
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
