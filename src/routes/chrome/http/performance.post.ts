import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Performance,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/performance.http.js';

export default class ChromePerformancePostRoute extends Performance {
  name = BrowserlessRoutes.ChromePerformancePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePerformance];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
