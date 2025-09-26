import {
  APITags,
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  Logger,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
  dedent,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumFunctionConnectWebSocketRoute extends BrowserWebsocketRoute {
  name = BrowserlessRoutes.ChromiumFunctionConnectWebSocketRoute;
  auth = true;
  concurrency = false;
  browser = ChromiumCDP;
  description = dedent(
    `Internally used by the POST /function API to connect the underlying client-side code to. Not intended for direct use but documented for completeness and to distinguish between other reconnect style calls.`,
  );
  path = WebsocketRoutes.functionClientConnect;
  tags = [APITags.browserWS];
  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    _logger: Logger,
    browser: ChromiumCDP,
  ): Promise<void> {
    return browser.proxyWebSocket(req, socket, head);
  }
}
