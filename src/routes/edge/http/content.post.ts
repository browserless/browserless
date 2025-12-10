import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { HTTPRoutes } from '../../../http.js';

import {
  BodySchema,
  default as Content,
  QuerySchema,
  ResponseSchema,
} from '../../../shared/content.http.js';

export default class EdgeContentPostRoute extends Content {
  name = BrowserlessRoutes.EdgeContentPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.edgeContent];
}

export { BodySchema, QuerySchema, ResponseSchema };
