import {
  default as ChromiumJSONVersionGetRoute,
  ResponseSchema,
} from '../../../shared/json-version.http.js';
import { BrowserlessRoutes } from '@browserless.io/browserless';

export default class ChromeJSONVersionGetRoute extends ChromiumJSONVersionGetRoute {
  name = BrowserlessRoutes.ChromeJSONVersionGetRoute;
}

export { ResponseSchema };
