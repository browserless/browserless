import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Performance,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/performance.http.js';

export default class ChromiumPerformancePostRoute extends Performance {
  name = BrowserlessRoutes.ChromiumPerformancePostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumPerformance];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
