import { Duplex } from 'stream';

import { CDPChromium } from '../../../browsers/cdp-chromium.js';

import {
  Request,
  WebsocketRoutes,
  SystemQueryParameters,
  APITags,
} from '../../../http.js';

import { BrowserWebsocketRoute, CDPLaunchOptions } from '../../../types.js';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

const route: BrowserWebsocketRoute = {
  auth: true,
  browser: CDPChromium,
  concurrency: false,
  description: `Connect to Chromium with a library like chrome-remote-interface or others that work over JSON chrome-devtools-protocol.`,
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    chrome: CDPChromium,
  ): Promise<void> => chrome.proxyPageWebSocket(req, socket, head),
  path: WebsocketRoutes.page,
  tags: [APITags.browserWS],
};

export default route;
