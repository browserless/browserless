import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  BodySchema,
  default as Performance,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/performance.http.js';

export default class EdgePerformancePostRoute extends Performance {
  name = BrowserlessRoutes.EdgePerformancePostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgePerformance];
}

export { BodySchema, QuerySchema, ResponseSchema };
