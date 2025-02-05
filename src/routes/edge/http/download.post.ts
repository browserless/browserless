import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  BodySchema,
  default as Download,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/download.http.js';

export default class EdgeDownloadPostRoute extends Download {
  name = BrowserlessRoutes.EdgeDownloadPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeDownload];
}

export { BodySchema, QuerySchema, ResponseSchema };
