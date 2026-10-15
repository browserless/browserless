import { BrowserlessRoutes } from '../../../types.js';
import ChromiumBQLPostRoute from '../../../shared/bql.http.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';
export {
  BodySchema,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/bql.http.js';

export default class EdgeBQLPostRoute extends ChromiumBQLPostRoute {
  name = BrowserlessRoutes.EdgeBQLPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeBQL];
}
