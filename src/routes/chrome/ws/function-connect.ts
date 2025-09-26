import {
  default as FunctionConnect,
  QuerySchema,
} from '../../../shared/function-connect.ws.js';
import { BrowserlessRoutes, ChromeCDP } from '@browserless.io/browserless';

export default class ChromeFunctionConnectWebSocketRoute extends FunctionConnect {
  name = BrowserlessRoutes.ChromeFunctionConnectWebSocketRoute;
  browser = ChromeCDP;
}

export { QuerySchema };
