import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Performance,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/performance.http.js';

export default class EdgePerformancePostRoute extends Performance {
  name = BrowserlessRoutes.EdgePerformancePostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgePerformance];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
