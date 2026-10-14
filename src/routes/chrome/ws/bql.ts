import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import ChromiumBQLWebsocketRoute from '../../chromium/ws/bql.js';
import { WebsocketRoutes } from '../../../http.js';
export { QuerySchema } from '../../chromium/ws/bql.js';

export default class ChromeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.ChromeBQLWebsocketRoute;
  browser = ChromeCDP;
  path = [WebsocketRoutes.chromeBQL];
}
