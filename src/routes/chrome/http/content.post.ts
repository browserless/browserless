import {
  BodySchema,
  default as Content,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/content.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromeContentPostRoute extends Content {
  name = BrowserlessRoutes.ChromeContentPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeContent];
}

export { BodySchema, QuerySchema, ResponseSchema };
