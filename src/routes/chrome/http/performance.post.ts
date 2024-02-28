import {
  BodySchema,
  default as Performance,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/performance.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromePerformancePostRoute extends Performance {
  name = BrowserlessRoutes.ChromePerformancePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePerformance];
}

export { BodySchema, QuerySchema, ResponseSchema };
