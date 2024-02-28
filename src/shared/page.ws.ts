import {
  APITags,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
  dedent,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
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
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: ChromiumCDP,
  ): Promise<void> => browser.proxyPageWebSocket(req, socket, head);
}
