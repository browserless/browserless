import {
  BodySchema,
  default as Content,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/content.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromeContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromeContentPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeContent];
}

export { BodySchema, QuerySchema, ResponseSchema };
