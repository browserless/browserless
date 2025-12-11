import { default as Page, QuerySchema } from '../../../shared/page.ws.js';

import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';

export default class ChromePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.ChromePageWebSocketRoute;
  browser = ChromeCDP;
  auth = false;
}

export { QuerySchema };
