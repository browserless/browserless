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
  concurrency: true,
  description: `Launch and connect to Chromium with a library like puppeteer or others that work over chrome-devtools-protocol.`,
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    chrome: CDPChromium,
  ): Promise<void> => chrome.proxyWebSocket(req, socket, head),
  path: WebsocketRoutes['/'],
  tags: [APITags.browserWS],
};

export default route;
