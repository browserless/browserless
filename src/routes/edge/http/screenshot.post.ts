import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

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
