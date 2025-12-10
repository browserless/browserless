import {
  BodySchema,
  default as Download,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/download.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromeDownloadPostRoute extends Download {
  name = BrowserlessRoutes.ChromeDownloadPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeDownload];
}

export { BodySchema, QuerySchema, ResponseSchema };
