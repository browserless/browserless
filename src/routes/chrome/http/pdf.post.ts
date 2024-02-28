import {
  BodySchema,
  default as PDF,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/pdf.http.js';
import {
  BrowserlessRoutes,
  ChromeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromePDFPostRoute extends PDF {
  name = BrowserlessRoutes.ChromePDFPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePdf];
}

export { BodySchema, QuerySchema, ResponseSchema };
