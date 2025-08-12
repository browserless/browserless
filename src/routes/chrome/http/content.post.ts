import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Content,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/content.http.js';

export default class ChromeContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromeContentPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeContent];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
