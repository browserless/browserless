import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  PlaywrightWebkit,
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
  browser: PlaywrightWebkit,
  concurrency: true,
  description: `Connect to Webkit with any playwright-compliant library.`,
  handler: async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: PlaywrightWebkit,
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
  path: WebsocketRoutes.playwrightWebkit,
  tags: [APITags.browserWS],
};

export default route;
