import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Download,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/download.http.js';

export default class ChromiumDownloadPostRoute extends Download {
  name = BrowserlessRoutes.ChromiumDownloadPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumDownload];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
