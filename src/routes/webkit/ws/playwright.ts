import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  Request,
  SystemQueryParameters,
  WebkitPlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions | string;
}

export default class WebKitPlaywrightWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.WebKitPlaywrightWebSocketRoute;
  auth = true;
  browser = WebkitPlaywright;
  concurrency = true;
  description = `Connect to Webkit with any playwright-compliant library.`;
  path = [WebsocketRoutes.playwrightWebkit, WebsocketRoutes.webkitPlaywright];
  tags = [APITags.browserWS];
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: WebkitPlaywright,
  ): Promise<void> => {
    const isPlaywright = req.headers['user-agent']
      ?.toLowerCase()
      .includes('playwright');

    if (!isPlaywright) {
      throw new BadRequest(
        `Only playwright is allowed to work with this route`,
      );
    }

    return browser.proxyWebSocket(req, socket, head);
  };
}
