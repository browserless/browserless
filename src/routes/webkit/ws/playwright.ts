import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  Logger,
  Request,
  SystemQueryParameters,
  WebKitPlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions | string;
}

export default class WebKitPlaywrightWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.WebKitPlaywrightWebSocketRoute;
  auth = true;
  browser = WebKitPlaywright;
  concurrency = true;
  description = `Connect to Webkit with any playwright-compliant library.`;
  path = [WebsocketRoutes.playwrightWebkit, WebsocketRoutes.webkitPlaywright];
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: WebKitPlaywright,
  ): Promise<void> {
    const isPlaywright = req.headers['user-agent']
      ?.toLowerCase()
      .includes('playwright');

    if (!isPlaywright) {
      throw new BadRequest(
        `Only playwright is allowed to work with this route`,
      );
    }

    return browser.proxyWebSocket(req, socket, head);
  }
}
