import {
  BrowserlessRoutes,
  EdgeCDP,
  HTTPRoutes,
} from '@browserless.io/browserless';

import {
  default as PDF,
  BodySchema as SharedBodySchema,
  QuerySchema as SharedQuerySchema,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/pdf.http.js';

export default class EdgePDFPostRoute extends PDF {
  name = BrowserlessRoutes.EdgePDFPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgePdf];
}

export type BodySchema = SharedBodySchema;
export type QuerySchema = SharedQuerySchema;
export type ResponseSchema = SharedResponseSchema;
