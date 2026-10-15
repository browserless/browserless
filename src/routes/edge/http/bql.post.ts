import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';
import ChromiumBQLPostRoute from '../../../shared/bql.http.js';
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
