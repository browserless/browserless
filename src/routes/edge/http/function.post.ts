import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

import {
  BodySchema,
  default as Function,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/function.http.js';

export default class EdgeFunctionPostRoute extends Function {
  name = BrowserlessRoutes.EdgeFunctionPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeFunction];
}

export { BodySchema, QuerySchema, ResponseSchema };
