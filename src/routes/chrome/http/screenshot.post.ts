import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Screenshot,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/screenshot.http.js';

export default class ChromeScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.ChromeScreenshotPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScreenshot];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
