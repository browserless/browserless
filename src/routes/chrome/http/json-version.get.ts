import { BrowserlessRoutes } from '../../../types.js';
export { ResponseSchema } from '../../../shared/json-version.http.js';
import { default as ChromiumJSONVersionGetRoute } from '../../../shared/json-version.http.js';

export default class ChromeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.ChromeJSONVersionGetRoute;
}
