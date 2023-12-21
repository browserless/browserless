import {
  BrowserHTTPRoute,
  BrowserWebsocketRoute,
  Config,
  HTTPRoute,
  Request,
  WebSocketRoute,
  getTokenFromRequest,
} from '@browserless.io/browserless';

export class Token {
  constructor(protected config: Config) {}

  public isAuthorized = (
    req: Request,
    route:
      | BrowserHTTPRoute
      | BrowserWebsocketRoute
      | HTTPRoute
      | WebSocketRoute,
  ): boolean => {
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
  };
}
