import {
  BodySchema,
  default as Download,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/download.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromeDownloadPostRoute extends Download {
  name = BrowserlessRoutes.ChromeDownloadPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeDownload];
}

export { BodySchema, QuerySchema, ResponseSchema };
