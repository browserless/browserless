import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Scrape,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/scrape.http.js';

export default class ChromiumScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.ChromiumScrapePostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumScrape];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
