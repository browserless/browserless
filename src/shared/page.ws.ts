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

  /**
   * The navigation target of a page created by `PUT /json/new?{url}`.
   * Browserless sets this on the `webSocketDebuggerUrl` it returns, because the
   * page does not exist until the client connects; callers do not normally set
   * it themselves. Route schemas are generated with `noExtraProps`, so it has
   * to be declared here or that connect is rejected as an unknown parameter.
   */
  url?: string;
}

export default class ChromiumPageWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.ChromiumPageWebSocketRoute;
  auth = true;
  browser = ChromiumCDP;
  concurrency = false;
  description = dedent(
    `Connect to an existing page in Chromium with a library like
    chrome-remote-interface or others that work the page websocketDebugger
    URL. You can get this unique URL by calling the /json/list API
    or by finding the page's unique ID from your library of choice.`,
  );
  path = WebsocketRoutes.page;
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: ChromiumCDP,
  ): Promise<void> {
    return browser.proxyPageWebSocket(req, socket, head);
  }
}
