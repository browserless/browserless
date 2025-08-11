import {
  default as ChromiumJSONNewPutRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-new.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class ChromeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.ChromeJSONNewPutRoute;
}

export type ResponseSchema = SharedResponseSchema;
