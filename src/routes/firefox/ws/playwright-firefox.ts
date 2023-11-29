import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  PlaywrightFirefox,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

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
      throw new BadRequest(
        `Only playwright is allowed to work with this route`,
      );
    }

    return browser.proxyWebSocket(req, socket, head);
  },
  path: WebsocketRoutes.playwrightFirefox,
  tags: [APITags.browserWS],
};

export default route;
