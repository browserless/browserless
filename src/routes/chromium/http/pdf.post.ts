import {
  default as Pdf,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/pdf.http.js';
import {
  BrowserlessRoutes,
  ChromiumCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

export default class ChromiumPDFPostRoute extends Pdf {
  name = BrowserlessRoutes.ChromiumPDFPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumPdf];
}
export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
