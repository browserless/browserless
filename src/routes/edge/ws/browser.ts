import { BrowserlessRoutes, EdgeCDP } from '@browserless.io/browserless';

import { default as Browser, QuerySchema } from '../../../shared/browser.ws.js';

export default class EdgeBrowserWebSocketRoute extends Browser {
  name = BrowserlessRoutes.EdgeBrowserWebSocketRoute;
  browser = EdgeCDP;
}

export { QuerySchema };
