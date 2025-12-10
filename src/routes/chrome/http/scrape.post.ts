import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Scrape,
} from '../../../shared/scrape.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromeScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.ChromeScrapePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScrape];
}

export { BodySchema, QuerySchema, ResponseSchema };
