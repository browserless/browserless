import {
  BrowserServerOptions,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
} from '../../../types.js';
import { FirefoxPlaywright } from '../../../browsers/browsers.playwright.js';
import {
  APITags,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '../../../http.js';
import { Logger } from '../../../logger.js';
import { BadRequest } from '../../../utils.js';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: BrowserServerOptions & {
    firefoxUserPrefs?: { [key: string]: string | number | boolean };
  };
}

export default class FirefoxPlaywrightWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.FirefoxPlaywrightWebSocketRoute;
  auth = true;
  browser = FirefoxPlaywright;
  concurrency = true;
  description = `Connect to Firefox with any playwright-compliant library.`;
  path = [WebsocketRoutes.firefoxPlaywright, WebsocketRoutes.playwrightFirefox];
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: FirefoxPlaywright,
  ): Promise<void> {
    const isPlaywright = req.headers['user-agent']
      ?.toLowerCase()
      .includes('playwright');

    if (!isPlaywright) {
      throw new BadRequest(
        `Only playwright is allowed to work with this route`,
      );
    }

    return browser.proxyWebSocket(req, socket, head);
  }
}
