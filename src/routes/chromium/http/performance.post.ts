import {
  BodySchema,
  default as Performance,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/performance.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumPerformancePostRoute extends Performance {
  name = BrowserlessRoutes.ChromiumPerformancePostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumPerformance];
}
