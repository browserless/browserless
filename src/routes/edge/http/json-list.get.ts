import {
  default as ChromiumJSONListGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-list.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.EdgeJSONListGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
