import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';
import { default as Page, QuerySchema } from '../../../shared/page.ws.js';

export default class ChromePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.ChromePageWebSocketRoute;
  browser = ChromeCDP;
  auth = false;
}

export { QuerySchema };
