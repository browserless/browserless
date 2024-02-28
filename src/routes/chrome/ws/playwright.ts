import {
  BrowserlessRoutes,
  ChromePlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import {
  default as ChromiumPlaywrightWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.playwright.ws.js';

export default class ChromePlaywrightWebSocketRoute extends ChromiumPlaywrightWebSocketRoute {
  name = BrowserlessRoutes.ChromePlaywrightWebSocketRoute;
  browser = ChromePlaywright;
  path = [WebsocketRoutes.chromePlaywright];
}

export { QuerySchema };
