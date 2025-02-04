import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Scrape,
} from '../../../shared/scrape.http.js';

export default class EdgeScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.EdgeScrapePostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeScrape];
}

export { BodySchema, QuerySchema, ResponseSchema };
