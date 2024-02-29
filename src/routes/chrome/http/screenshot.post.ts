import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Screenshot,
} from '../../../shared/screenshot.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromeScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.ChromeScreenshotPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeScreenshot];
}

export { BodySchema, QuerySchema, ResponseSchema };
