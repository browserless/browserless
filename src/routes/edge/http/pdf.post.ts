import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  BodySchema,
  default as PDF,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/pdf.http.js';

export default class EdgePDFPostRoute extends PDF {
  name = BrowserlessRoutes.EdgePDFPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgePdf];
}

export { BodySchema, QuerySchema, ResponseSchema };
