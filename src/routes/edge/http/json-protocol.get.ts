import { default as ChromiumJSONProtocolGetRoute, ResponseSchema } from '../../../shared/json-protocol.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.EdgeJSONProtocolGetRoute;
}

export { ResponseSchema };
