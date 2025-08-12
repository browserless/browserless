import { BrowserlessRoutes } from '@browserless.io/browserless';

import {
  default as ChromiumJSONProtocolGetRoute,
  ResponseSchema as SharedResponseSchema,
} from '../../../shared/json-protocol.http.js';

export default class ChromeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.ChromeJSONProtocolGetRoute;
}

export type ResponseSchema = SharedResponseSchema;
