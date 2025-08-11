import {
  default as ChromiumJSONVersionGetRoute,
  ResponseSchema,
} from '../../../shared/json-version.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class EdgeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.EdgeJSONVersionGetRoute;
}

export { ResponseSchema };
