import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Download,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/download.http.js';

export default class ChromeDownloadPostRoute extends Download {
  name = BrowserlessRoutes.ChromeDownloadPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeDownload];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
