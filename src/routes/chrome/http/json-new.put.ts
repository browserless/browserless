import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONNewPutRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-new.http.js';

export default class ChromeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.ChromeJSONNewPutRoute;
}

export type ResponseSchema = SharedResponseSchema;
