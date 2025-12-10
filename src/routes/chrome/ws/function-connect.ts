import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import {
  default as FunctionConnect,
  QuerySchema,
} from '../../../shared/function-connect.ws.js';

export default class ChromeFunctionConnectWebSocketRoute extends FunctionConnect {
  name = BrowserlessRoutes.ChromeFunctionConnectWebSocketRoute;
  browser = ChromeCDP;
}

export { QuerySchema };
