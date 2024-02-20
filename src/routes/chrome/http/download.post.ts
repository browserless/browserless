import {
  BodySchema,
  default as Download,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/download.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromeDownloadRoute extends Download {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromeDownload];
}

export { BodySchema, QuerySchema, ResponseSchema };
