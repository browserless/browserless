import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Screenshot,
} from '../../../shared/screenshot.http.js';

export default class EdgeScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.EdgeScreenshotPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeScreenshot];
}

export { BodySchema, QuerySchema, ResponseSchema };
