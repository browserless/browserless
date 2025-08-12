import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONListGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-list.http.js';

export default class EdgeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.EdgeJSONListGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
