import {
  default as FunctionConnect,
  QuerySchema,
} from '../../../shared/function-connect.ws.js';
import { BrowserlessRoutes, EdgeCDP } from '@browserless.io/browserless';

export default class EdgeFunctionConnectWebSocketRoute extends FunctionConnect {
  name = BrowserlessRoutes.EdgeFunctionConnectWebSocketRoute;
  browser = EdgeCDP;
}

export { QuerySchema };
