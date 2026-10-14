import { BrowserlessRoutes } from '../../../types.js';
import ChromiumBQLWebsocketRoute from '../../chromium/ws/bql.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { WebsocketRoutes } from '../../../http.js';
export { QuerySchema } from '../../chromium/ws/bql.js';

export default class EdgeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.EdgeBQLWebsocketRoute;
  browser = EdgeCDP;
  path = [WebsocketRoutes.edgeBQL];
}
