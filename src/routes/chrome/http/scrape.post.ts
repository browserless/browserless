import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Scrape,
} from '../../../shared/scrape.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromeScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.ChromeScrapePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScrape];
}

export { BodySchema, QuerySchema, ResponseSchema };
