import { BrowserlessRoutes } from '../../../types.js';
export { ResponseSchema } from '../../../shared/json-new.http.js';
import { default as ChromiumJSONNewPutRoute } from '../../../shared/json-new.http.js';

export default class ChromeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.ChromeJSONNewPutRoute;
}
