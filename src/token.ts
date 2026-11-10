import {
  BrowserHTTPRoute,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  Config,
  HTTPRoute,
  Request,
  WebSocketRoute,
  getTokenFromRequest,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';

type AuthRoute =
  BrowserHTTPRoute | BrowserWebsocketRoute | HTTPRoute | WebSocketRoute;

export class Token extends EventEmitter {
  constructor(protected config: Config) {
    super();
  }

  public async isAuthorized(req: Request, route: AuthRoute): Promise<boolean> {
    const token = this.config.getToken();

    if (token === null) {
      return true;
    }

    if (!this.requiresStrictAuth(route)) {
      try {
        const requiresToken =
          typeof route.auth === 'function' ? await route.auth(req) : route.auth;
        if (!requiresToken) {
          return true;
        }
      } catch {
        // A failed policy must not grant access, even with a valid token.
        return false;
      }
    }

    const requestToken = getTokenFromRequest(req);

    if (!requestToken) {
      return false;
    }

    return (Array.isArray(token) ? token : [token]).includes(requestToken);
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
