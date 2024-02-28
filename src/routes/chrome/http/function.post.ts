import {
  BodySchema,
  default as Function,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/function.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromeFunctionPostRoute extends Function {
  name = BrowserlessRoutes.ChromeFunctionPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeFunction];
}

export { BodySchema, QuerySchema, ResponseSchema };
