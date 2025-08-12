import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONListGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-list.http.js';

export default class ChromeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.ChromeJSONListGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
