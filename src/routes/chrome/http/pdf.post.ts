import {
  BodySchema,
  default as PDF,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/pdf.http.js';
import { ChromeCDP, HTTPRoutes } from '@browserless.io/browserless';

export default class ChromePDF extends PDF {
  browser = ChromeCDP;
  path = [HTTPRoutes.chromePdf];
}

export { BodySchema, QuerySchema, ResponseSchema };
