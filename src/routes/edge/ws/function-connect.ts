import { BrowserlessRoutes, EdgeCDP } from '@browserless.io/browserless';
import {
  default as FunctionConnect,
  QuerySchema,
} from '../../../shared/function-connect.ws.js';

export default class EdgeFunctionConnectWebSocketRoute extends FunctionConnect {
  name = BrowserlessRoutes.EdgeFunctionConnectWebSocketRoute;
  browser = EdgeCDP;
}

export { QuerySchema };
