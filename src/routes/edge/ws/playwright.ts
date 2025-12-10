import { BrowserlessRoutes } from '../../../types.js';
import { EdgePlaywright } from '../../../browsers/browsers.playwright.js';
import { WebsocketRoutes } from '../../../http.js';
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
