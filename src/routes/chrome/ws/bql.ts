import {
  BrowserlessRoutes,
  ChromeCDP,
  WebsocketRoutes,
} from '@browserless.io/browserless';
import ChromiumBQLWebsocketRoute from '../../../shared/bql.ws.js';
export { QuerySchema } from '../../../shared/bql.ws.js';

export default class ChromeBQLWebsocketRoute extends ChromiumBQLWebsocketRoute {
  name = BrowserlessRoutes.ChromeBQLWebsocketRoute;
  browser = ChromeCDP;
  path = [WebsocketRoutes.chromeBQL];
}
