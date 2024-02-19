import {
  BodySchema,
  default as Performance,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/performance.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromePerformance extends Performance {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePerformance];
}

export { BodySchema, QuerySchema, ResponseSchema };
