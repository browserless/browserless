import {
  BrowserlessRoutes,
  EdgeCDP,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import {
  default as ChromiumWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.ws.js';

export default class EdgeCDPWebSocketRoute extends ChromiumWebSocketRoute {
  name = BrowserlessRoutes.EdgeCDPWebSocketRoute;
  browser = EdgeCDP;
  path = [WebsocketRoutes.edge];
}

export { QuerySchema };
