import {
  APITags,
  BrowserWebsocketRoute,
  CDPChromium,
  CDPLaunchOptions,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class PageWebSocketRoute extends BrowserWebsocketRoute {
  auth = true;
  browser = CDPChromium;
  concurrency = false;
  description = `Connect to Chromium with a library like chrome-remote-interface or others that work over JSON chrome-devtools-protocol.`;
  path = WebsocketRoutes.page;
  tags = [APITags.browserWS];
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: CDPChromium,
  ): Promise<void> => browser.proxyPageWebSocket(req, socket, head);
}
