import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import ChromiumBQLPostRoute from '../../../shared/bql.http.js';
import { HTTPRoutes } from '../../../http.js';
export {
  BodySchema,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/bql.http.js';

export default class ChromeBQLPostRoute extends ChromiumBQLPostRoute {
  name = BrowserlessRoutes.ChromeBQLPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeBQL];
}
