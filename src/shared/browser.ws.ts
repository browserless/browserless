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
  dedent,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumBrowserWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.ChromiumBrowserWebSocketRoute;
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  description = dedent(
    `Connect to an already-running Chromium process with a library like
    puppeteer, or others, that work over chrome-devtools-protocol. Chromium
    must already be launched in order to not return a 404.`,
  );
  path = WebsocketRoutes.browser;
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
