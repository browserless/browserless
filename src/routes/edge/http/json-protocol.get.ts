import { BrowserlessRoutes } from '@browserless.io/browserless';
import { default as ChromiumJSONProtocolGetRoute } from '../../../shared/json-protocol.http.js';
export { ResponseSchema } from '../../../shared/json-protocol.http.js';

export default class EdgeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.EdgeJSONProtocolGetRoute;
}
