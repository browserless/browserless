import {
  default as Content,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/content.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromiumContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromiumContentPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumContent];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
