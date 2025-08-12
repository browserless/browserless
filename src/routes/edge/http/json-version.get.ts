import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONVersionGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-version.http.js';

export default class EdgeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.EdgeJSONVersionGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
