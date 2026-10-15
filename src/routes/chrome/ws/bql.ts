import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import ChromiumBQLWebsocketRoute from '../../../shared/bql.ws.js';
import { WebsocketRoutes } from '../../../http.js';
export { QuerySchema } from '../../../shared/bql.ws.js';

export default class ChromeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.ChromeBQLWebsocketRoute;
  browser = ChromeCDP;
  path = [WebsocketRoutes.chromeBQL];
}
