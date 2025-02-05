import { BrowserlessRoutes } from '@browserless.io/browserless';
import { default as ChromiumJSONListGetRoute } from '../../../shared/json-list.http.js';
export { ResponseSchema } from '../../../shared/json-list.http.js';

export default class EdgeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.EdgeJSONListGetRoute;
}
