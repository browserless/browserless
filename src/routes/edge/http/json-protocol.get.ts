import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONProtocolGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-protocol.http.js';

export default class EdgeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.EdgeJSONProtocolGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
