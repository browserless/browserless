import { Duplex } from 'stream';

import { PlaywrightChromium } from '../../../browsers/playwright-chromium.js';

import {
  Request,
  WebsocketRoutes,
  SystemQueryParameters,
  APITags,
} from '../../../http.js';

import { BrowserServerOptions, BrowserWebsocketRoute } from '../../../types.js';
import * as util from '../../../utils.js';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions | string;
}

const route: BrowserWebsocketRoute = {
  auth: true,
  browser: PlaywrightChromium,
  concurrency: true,
  description: `Connect to Chromium with any playwright-compliant library.`,
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: PlaywrightChromium,
  ): Promise<void> => {
    const isPlaywright = req.headers['user-agent']
      ?.toLowerCase()
      .includes('playwright');

    if (!isPlaywright) {
      throw new util.BadRequest(
        `Only playwright is allowed to work with this route`,
      );
    }

    return browser.proxyWebSocket(req, socket, head);
  },
  path: WebsocketRoutes.playwrightChromium,
  tags: [APITags.browserWS],
};

export default route;
