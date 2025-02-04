import { BrowserlessRoutes } from '@browserless.io/browserless';
import { default as ChromiumJSONNewPutRoute } from '../../../shared/json-new.http.js';
export { ResponseSchema } from '../../../shared/json-new.http.js';

export default class EdgeJSONNewPutRoute extends ChromiumJSONNewPutRoute {
  name = BrowserlessRoutes.EdgeJSONNewPutRoute;
}
