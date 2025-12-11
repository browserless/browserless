import {
  default as ChromiumWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.ws.js';

import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { WebsocketRoutes } from '../../../http.js';

export default class EdgeCDPWebSocketRoute extends ChromiumWebSocketRoute {
  name = BrowserlessRoutes.EdgeCDPWebSocketRoute;
  browser = EdgeCDP;
  path = [WebsocketRoutes.edge];
}

export { QuerySchema };
