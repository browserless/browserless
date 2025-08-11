import { BrowserlessRoutes, ChromeCDP } from '@browserless.io/browserless';
import {
  default as Page,
  QuerySchema as SharedQuerySchema,
} from '../../../shared/page.ws.js';

export default class ChromePageWebSocketRoute extends Page {
  name = BrowserlessRoutes.ChromePageWebSocketRoute;
  browser = ChromeCDP;
  auth = false;
}

export type QuerySchema = SharedQuerySchema;
