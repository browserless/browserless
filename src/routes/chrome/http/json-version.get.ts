import { BrowserlessRoutes } from '@browserless.io/browserless';
export { ResponseSchema } from '../../../shared/json-version.http.js';
import { default as ChromiumJSONVersionGetRoute } from '../../../shared/json-version.http.js';

export default class ChromeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.ChromeJSONVersionGetRoute;
}
