import {
  BrowserlessRoutes,
  ChromiumPlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';

import {
  default as Playwright,
  QuerySchema as SharedQuerySchema,
} from '../../../shared/chromium.playwright.ws.js';

export default class ChromiumPlaywrightWebSocketRoute extends Playwright {
  name = BrowserlessRoutes.ChromiumPlaywrightWebSocketRoute;
  browser = ChromiumPlaywright;
  path = [WebsocketRoutes.chromiumPlaywright];
}
export type QuerySchema = SharedQuerySchema;
