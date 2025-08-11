import { BrowserlessRoutes, EdgeCDP } from '@browserless.io/browserless';

import {
  default as Browser,
  QuerySchema as SharedQuerySchema,
} from '../../../shared/browser.ws.js';

export default class EdgeBrowserWebSocketRoute extends Browser {
  name = BrowserlessRoutes.EdgeBrowserWebSocketRoute;
  browser = EdgeCDP;
}

export type QuerySchema = SharedQuerySchema;
