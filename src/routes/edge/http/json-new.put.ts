import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONNewPutRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-new.http.js';

export default class EdgeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.EdgeJSONNewPutRoute;
}

export type ResponseSchema = SharedResponseSchema;
