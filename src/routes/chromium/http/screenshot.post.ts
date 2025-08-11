import {
  default as Screenshot,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/screenshot.http.js';

import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromiumScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.ChromiumScreenshotPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumScreenshot];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
