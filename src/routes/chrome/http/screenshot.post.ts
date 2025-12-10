import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Screenshot,
} from '../../../shared/screenshot.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromeScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.ChromeScreenshotPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScreenshot];
}

export { BodySchema, QuerySchema, ResponseSchema };
