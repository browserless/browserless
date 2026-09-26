import { BrowserlessRoutes, EdgeCDP } from '@browserless.io/browserless';
import { default as Page, QuerySchema } from '../../../shared/page.ws.js';

export default class EdgePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.EdgePageWebSocketRoute;
  browser = EdgeCDP;
  auth = false;
}

export { QuerySchema };
