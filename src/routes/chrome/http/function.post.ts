import {
  BodySchema,
  default as Function,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/function.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromeFunctionPostRoute extends Function {
  name = BrowserlessRoutes.ChromeFunctionPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeFunction];
}

export { BodySchema, QuerySchema, ResponseSchema };
