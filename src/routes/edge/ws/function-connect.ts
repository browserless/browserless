import {
  default as FunctionConnect,
  QuerySchema,
} from '../../../shared/function-connect.ws.js';

import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';

export default class EdgeFunctionConnectWebSocketRoute extends FunctionConnect {
  name = BrowserlessRoutes.EdgeFunctionConnectWebSocketRoute;
  browser = EdgeCDP;
}

export { QuerySchema };
