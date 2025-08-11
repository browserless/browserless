import {
  default as ChromiumJSONVersionGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-version.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class ChromeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.ChromeJSONVersionGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
