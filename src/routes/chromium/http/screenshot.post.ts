import {
  BodySchema,
  QuerySchema,
  ResponseSchema,
  default as Screenshot,
} from '../../../shared/screenshot.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumScreenshotPostRoute extends Screenshot {
  name = BrowserlessRoutes.ChromiumScreenshotPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumScreenshot];
}
