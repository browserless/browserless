import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';
import ChromiumBQLPostRoute from '../../../shared/bql.http.js';
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
