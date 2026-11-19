import {
  BrowserlessRoutes,
  EdgeCDP,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import ChromiumBQLWebsocketRoute from '../../../shared/bql.ws.js';
export { QuerySchema } from '../../../shared/bql.ws.js';

export default class EdgeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.EdgeBQLWebsocketRoute;
  browser = EdgeCDP;
  path = [WebsocketRoutes.edgeBQL];
}
