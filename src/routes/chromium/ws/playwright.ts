import {
  BrowserlessRoutes,
  ChromiumPlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import {
  default as Playwright,
  QuerySchema,
} from '../../../shared/chromium.playwright.ws.js';

export { QuerySchema };

export default class ChromiumPlaywrightWebSocketRoute extends Playwright {
  name = BrowserlessRoutes.ChromiumPlaywrightWebSocketRoute;
  browser = ChromiumPlaywright;
  path = [WebsocketRoutes.chromiumPlaywright];
}
