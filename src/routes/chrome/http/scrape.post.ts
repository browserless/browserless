import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Scrape,
} from '../../../shared/scrape.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromeScrape extends Scrape {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScrape];
}

export { BodySchema, QuerySchema, ResponseSchema };
