import {
  default as ChromiumJSONListGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-list.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class ChromeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.ChromeJSONListGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
