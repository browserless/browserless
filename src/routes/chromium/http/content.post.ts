import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Content,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/content.http.js';

export default class ChromiumContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromiumContentPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumContent];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
