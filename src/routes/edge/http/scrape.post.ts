import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Scrape,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/scrape.http.js';

export default class EdgeScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.EdgeScrapePostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeScrape];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
