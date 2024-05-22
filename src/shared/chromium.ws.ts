import {
  APITags,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  Logger,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumCDPWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.ChromiumCDPWebSocketRoute;
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  description = `Launch and connect to Chromium with a library like puppeteer or others that work over chrome-devtools-protocol.`;
  path = [WebsocketRoutes['/'], WebsocketRoutes.chromium];
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: ChromiumCDP,
  ): Promise<void> {
    return browser.proxyWebSocket(req, socket, head);
  }
}
