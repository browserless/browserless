import { BrowserlessRoutes } from '../../../types.js';
import { EdgeCDP } from '../../../browsers/browsers.cdp.js';

import { default as Browser, QuerySchema } from '../../../shared/browser.ws.js';

export default class EdgeBrowserWebSocketRoute extends Browser {
  name = BrowserlessRoutes.EdgeBrowserWebSocketRoute;
  browser = EdgeCDP;
}

export { QuerySchema };
