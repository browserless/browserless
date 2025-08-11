import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as Screenshot,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/screenshot.http.js';

export default class EdgeScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.EdgeScreenshotPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeScreenshot];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
