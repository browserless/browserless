import { default as Browser, QuerySchema } from '../../../shared/browser.ws.js';
import { BrowserlessRoutes, ChromeCDP } from '@browserless.io/browserless';

export default class ChromeBrowserWebSocketRoute extends Browser {
  name = BrowserlessRoutes.ChromeBrowserWebSocketRoute;
  browser = ChromeCDP;
}

export { QuerySchema };
