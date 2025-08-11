import {
  default as PDF,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
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

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
