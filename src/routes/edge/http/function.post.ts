import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Function,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/function.http.js';

export default class EdgeFunctionPostRoute extends Function {
  name = BrowserlessRoutes.EdgeFunctionPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeFunction];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
