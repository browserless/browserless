import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Scrape,
} from '../../../shared/scrape.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.ChromiumScrapePostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumScrape];
}
