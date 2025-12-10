import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

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
