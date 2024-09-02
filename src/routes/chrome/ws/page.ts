import { BrowserlessRoutes, ChromeCDP } from '@browserless.io/browserless';
import { default as Page, QuerySchema } from '../../../shared/page.ws.js';

export default class ChromePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.ChromePageWebSocketRoute;
  browser = ChromeCDP;
  auth = false;
}

export { QuerySchema };
