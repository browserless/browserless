import {
  default as ChromiumJSONNewPutRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-new.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.EdgeJSONNewPutRoute;
}

export type ResponseSchema = SharedResponseSchema;
