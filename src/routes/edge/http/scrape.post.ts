import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

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
