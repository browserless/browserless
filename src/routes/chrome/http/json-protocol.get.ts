import {
  default as ChromiumJSONProtocolGetRoute,
  ResponseSchema,
} from '../../../shared/json-protocol.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class ChromeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.ChromeJSONProtocolGetRoute;
}

export { ResponseSchema };
