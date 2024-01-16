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

export default class CDPChromiumRoute extends BrowserWebsocketRoute {
  auth = true;
  browser = CDPChromium;
  concurrency = true;
  description = `Launch and connect to Chromium with a library like puppeteer or others that work over chrome-devtools-protocol.`;
  path = WebsocketRoutes['/'];
  tags = [APITags.browserWS];
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    chrome: CDPChromium,
  ): Promise<void> => chrome.proxyWebSocket(req, socket, head);
}
