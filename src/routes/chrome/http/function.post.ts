import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Function,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/function.http.js';

export default class ChromeFunctionPostRoute extends Function {
  name = BrowserlessRoutes.ChromeFunctionPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeFunction];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
