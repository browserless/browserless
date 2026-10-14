import {
  APITags,
  Request,
  SystemQueryParameters,
  WebsocketRoutes,
} from '../../../http.js';
import {
  BQLWebSocketSession,
  BQL_WEBSOCKET_PROTOCOL,
} from '../../../bql/ws-session.js';
import {
  BrowserWebsocketRoute,
  BrowserlessRoutes,
  CDPLaunchOptions,
} from '../../../types.js';
import { ChromiumCDP } from '../../../browsers/browsers.cdp.js';
import type { Duplex } from 'node:stream';
import type { Logger } from '../../../logger.js';
import { WebSocketServer } from 'ws';
import { markSocketAsProxied } from '../../../utils.js';

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumBQLWebsocketRoute extends BrowserWebsocketRoute<ChromiumCDP> {
  name = BrowserlessRoutes.ChromiumBQLWebsocketRoute;
  browser = ChromiumCDP;
  path = [WebsocketRoutes.chromiumBQL];
  tags = [APITags.BQL];
  auth = true;
  concurrency = true;
  description =
    'Execute BrowserQL operations and subscriptions over a persistent WebSocket session.';

  async handler(
    req: Request,
    socket: Duplex,
    head: Buffer,
    logger: Logger,
    browser: ChromiumCDP,
  ): Promise<void> {
    const bql = this.bql();
    const server = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) =>
        protocols.has(BQL_WEBSOCKET_PROTOCOL) ? BQL_WEBSOCKET_PROTOCOL : false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const onClose = () => resolve();
        socket.once('close', onClose);
        server.handleUpgrade(req, socket, head, (client) => {
          socket.off('close', onClose);
          markSocketAsProxied(socket);
          const context = bql.createContext({
            req,
            browser,
            config: this.config(),
            logger,
            blockConsentModals: false,
          });
          new BQLWebSocketSession(client, bql, context)
            .run()
            .then(resolve, reject);
        });
      });
    } finally {
      server.close();
    }
  }
}
