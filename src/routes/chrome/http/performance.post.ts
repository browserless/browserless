import {
  BodySchema,
  default as Performance,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/performance.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromePerformancePostRoute extends Performance {
  name = BrowserlessRoutes.ChromePerformancePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePerformance];
}

export { BodySchema, QuerySchema, ResponseSchema };
