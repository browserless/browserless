import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';
import { default as Page, QuerySchema } from '../../../shared/page.ws.js';

export default class EdgePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.EdgePageWebSocketRoute;
  browser = EdgeCDP;
  auth = false;
}

export { QuerySchema };
