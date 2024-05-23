import {
  BrowserHTTPRoute,
  BrowserWebsocketRoute,
  Config,
  HTTPRoute,
  Request,
  WebSocketRoute,
  getTokenFromRequest,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';

export class Token extends EventEmitter {
  constructor(protected config: Config) {
    super();
  }

  public async isAuthorized(
    req: Request,
    route:
      | BrowserHTTPRoute
      | BrowserWebsocketRoute
      | HTTPRoute
      | WebSocketRoute,
  ): Promise<boolean> {
    const token = this.config.getToken();

    if (token === null) {
      return true;
    }

    if (route.auth !== true) {
      return true;
    }

    const requestToken = getTokenFromRequest(req);

    if (!requestToken) {
      return false;
    }

    return (Array.isArray(token) ? token : [token]).includes(requestToken);
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
