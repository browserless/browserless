import { BrowserlessRoutes } from '../../../types.js';
import ChromiumBQLPostRoute from '../../chromium/http/bql.post.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';
export {
  BodySchema,
  QuerySchema,
  ResponseSchema,
} from '../../chromium/http/bql.post.js';

export default class EdgeBQLPostRoute extends ChromiumBQLPostRoute {
  name = BrowserlessRoutes.EdgeBQLPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeBQL];
}
