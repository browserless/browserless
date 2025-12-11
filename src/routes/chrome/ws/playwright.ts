import {
  default as ChromiumPlaywrightWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.playwright.ws.js';

import { BrowserlessRoutes } from '../../../types.js';
import { ChromePlaywright } from '../../../browsers/browsers.playwright.js';
import { WebsocketRoutes } from '../../../http.js';

export default class ChromePlaywrightWebSocketRoute extends ChromiumPlaywrightWebSocketRoute {
  name = BrowserlessRoutes.ChromePlaywrightWebSocketRoute;
  browser = ChromePlaywright;
  path = [WebsocketRoutes.chromePlaywright];
}

export { QuerySchema };
