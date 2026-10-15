import { BrowserlessRoutes } from '../../../types.js';
import ChromiumBQLWebsocketRoute from '../../../shared/bql.ws.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { WebsocketRoutes } from '../../../http.js';
export { QuerySchema } from '../../../shared/bql.ws.js';

export default class EdgeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.EdgeBQLWebsocketRoute;
  browser = EdgeCDP;
  path = [WebsocketRoutes.edgeBQL];
}
