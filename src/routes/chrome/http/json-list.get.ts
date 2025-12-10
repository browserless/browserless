import { BrowserlessRoutes } from '../../../types.js';
export { ResponseSchema } from '../../../shared/json-list.http.js';
import { default as ChromiumJSONListGetRoute } from '../../../shared/json-list.http.js';

export default class ChromeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.ChromeJSONListGetRoute;
}
