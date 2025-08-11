import {
  default as Function,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/function.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromiumFunctionPostRoute extends Function {
  name = BrowserlessRoutes.ChromiumFunctionPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumFunction];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
