import {
  BodySchema,
  default as Pdf,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/pdf.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export { BodySchema, QuerySchema, ResponseSchema };

export default class ChromiumPDFPostRoute extends Pdf {
  name = BrowserlessRoutes.ChromiumPDFPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumPdf];
}
