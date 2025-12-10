import {
  BodySchema,
  default as PDF,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/pdf.http.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

export default class ChromePDFPostRoute extends PDF {
  name = BrowserlessRoutes.ChromePDFPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePdf];
}

export { BodySchema, QuerySchema, ResponseSchema };
