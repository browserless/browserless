import {
  APITags,
  BadRequest,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  FirefoxPlaywright,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions & {
    firefoxUserPrefs?: { [key: string]: string | number | boolean };
  };
}

export default class FirefoxPlayWrightRoute extends BrowserWebsocketRoute {
  auth = true;
  browser = FirefoxPlaywright;
  concurrency = true;
  description = `Connect to Firefox with any playwright-compliant library.`;
  path = [WebsocketRoutes.playwrightFirefox, WebsocketRoutes.firefoxPlaywright];
  tags = [APITags.browserWS];
  handler = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
    browser: FirefoxPlaywright,
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
  };
}
