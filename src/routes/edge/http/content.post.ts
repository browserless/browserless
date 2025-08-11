import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Content,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/content.http.js';

export default class EdgeContentPostRoute extends Content {
  name = BrowserlessRoutes.EdgeContentPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeContent];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
