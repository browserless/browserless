import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Scrape,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/scrape.http.js';

export default class ChromeScrapePostRoute extends Scrape {
  name = BrowserlessRoutes.ChromeScrapePostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScrape];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
