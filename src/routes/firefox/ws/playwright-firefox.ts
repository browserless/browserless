import { Duplex } from 'stream';

import { PlaywrightFirefox } from '../../../browsers/playwright-firefox.js';
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
  browser: PlaywrightFirefox,
  concurrency: true,
  description: `Connect to Firefox with any playwright-compliant library.`,
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: PlaywrightFirefox,
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
  path: WebsocketRoutes.playwrightFirefox,
  tags: [APITags.browserWS],
};

export default route;
