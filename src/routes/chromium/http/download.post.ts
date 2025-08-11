import {
  BodySchema,
  default as Download,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/download.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumDownloadPostRoute extends Download {
  name = BrowserlessRoutes.ChromiumDownloadPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumDownload];
}
