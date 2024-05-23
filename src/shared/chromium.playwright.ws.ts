import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  ChromiumPlaywright,
  Logger,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions | string;
}

export default class ChromiumPlaywrightWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.ChromiumPlaywrightWebSocketRoute;
  auth = true;
  browser = ChromiumPlaywright;
  concurrency = true;
  description = `Connect to Chromium with any playwright style library.`;
  path = [
    WebsocketRoutes.playwrightChromium,
    WebsocketRoutes.chromiumPlaywright,
  ];
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: ChromiumPlaywright,
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
