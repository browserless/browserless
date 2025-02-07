import {
  BrowserlessRoutes,
  EdgePlaywright,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import {
  default as ChromiumPlaywrightWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.playwright.ws.js';

export default class EdgePlaywrightWebSocketRoute extends ChromiumPlaywrightWebSocketRoute {
  name = BrowserlessRoutes.EdgePlaywrightWebSocketRoute;
  browser = EdgePlaywright;
  path = [WebsocketRoutes.edgePlaywright];
}

export { QuerySchema };
