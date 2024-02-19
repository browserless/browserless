import { ChromeCDP, WebsocketRoutes } from '@browserless.io/browserless';
import {
  default as ChromiumWebSocketRoute,
  QuerySchema,
} from '../../../shared/chromium.ws.js';

export default class Chrome extends ChromiumWebSocketRoute {
  browser = ChromeCDP;
  path = [WebsocketRoutes.chrome];
}

export { QuerySchema };
