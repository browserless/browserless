import { default as ChromiumJSONListGetRoute, ResponseSchema } from '../../../shared/json-list.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONListGetRoute extends ChromiumJSONListGetRoute {
  name = BrowserlessRoutes.EdgeJSONListGetRoute;
}

export { ResponseSchema };
