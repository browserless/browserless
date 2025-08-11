import {
  default as ChromiumJSONVersionGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-version.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.EdgeJSONVersionGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
