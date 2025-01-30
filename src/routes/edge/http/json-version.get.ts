import { BrowserlessRoutes } from '@browserless.io/browserless';
import { default as ChromiumJSONVersionGetRoute } from '../../../shared/json-version.http.js';
export { ResponseSchema } from '../../../shared/json-version.http.js';

export default class EdgeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.EdgeJSONVersionGetRoute;
}
