import { default as Browser, QuerySchema } from '../../../shared/browser.ws.js';
import { BrowserlessRoutes } from '../../../types.js';
import { ChromeCDP } from '../../../browsers/browsers.cdp.js';

export default class ChromeBrowserWebSocketRoute extends Browser {
  name = BrowserlessRoutes.ChromeBrowserWebSocketRoute;
  browser = ChromeCDP;
}

export { QuerySchema };
