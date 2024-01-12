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

export default class CDPExistingBrowser extends BrowserWebsocketRoute {
  auth = true;
  browser = CDPChromium;
  concurrency = false;
  description = `Connect to an already-running Chromium with a library like puppeteer, or others, that work over chrome-devtools-protocol.`;
  path = WebsocketRoutes.browser;
  tags = [APITags.browserWS];
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    chrome: CDPChromium,
  ): Promise<void> => chrome.proxyWebSocket(req, socket, head);
}
