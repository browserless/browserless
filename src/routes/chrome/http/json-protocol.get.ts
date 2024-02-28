import { BrowserlessRoutes } from '@browserless.io/browserless';
export { ResponseSchema } from '../../../shared/json-protocol.http.js';
import { default as ChromiumJSONProtocolGetRoute } from '../../../shared/json-protocol.http.js';

export default class ChromeJSONProtocolGetRoute extends ChromiumJSONProtocolGetRoute {
  name = BrowserlessRoutes.ChromeJSONProtocolGetRoute;
}
