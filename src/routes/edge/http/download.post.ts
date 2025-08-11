import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Download,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/download.http.js';

export default class EdgeDownloadPostRoute extends Download {
  name = BrowserlessRoutes.EdgeDownloadPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeDownload];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
