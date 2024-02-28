import {
  BrowserlessRoutes,
  ChromeCDP,
  WebsocketRoutes,
} from '@browserless.io/browserless';
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
