import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { WebsocketRoutes } from '../../../http.js';
import {
  default as ChromiumWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.ws.js';

export default class ChromeCDPWebSocketRoute extends ChromiumWebSocketRoute {
  name = BrowserlessRoutes.ChromeCDPWebSocketRoute;
  browser = ChromeCDP;
  path = [WebsocketRoutes.chrome];
}

export { QuerySchema };
