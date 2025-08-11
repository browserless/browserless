import {
  BodySchema,
  default as Function,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/function.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumFunctionPostRoute extends Function {
  name = BrowserlessRoutes.ChromiumFunctionPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumFunction];
}
