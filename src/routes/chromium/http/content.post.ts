import {
  BodySchema,
  default as Content,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/content.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromiumContentPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumContent];
}
