import {
  APITags,
  BrowserlessRoutes,
  CDPJSONPayload,
  HTTPRoute,
  HTTPRoutes,
  Methods,
  Request,
  Response,
  contentTypes,
  dedent,
  jsonResponse,
  pageID,
} from '@browserless.io/browserless';
import path from 'path';

/*
Example Payload from Chromium:
{
  "description": "",
  "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:9222/devtools/page/2F76525C32A916DF30C4F37A4970B8BF",
  "id": "2F76525C32A916DF30C4F37A4970B8BF",
  "title": "",
  "type": "page",
  "url": "about:blank",
  "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/2F76525C32A916DF30C4F37A4970B8BF"
}
*/
export type ResponseSchema = CDPJSONPayload;

export default class ChromiumJSONNewPutRoute extends HTTPRoute {
  name = BrowserlessRoutes.ChromiumJSONNewPutRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = dedent(`
    Returns a JSON payload that acts as a pass-through to the DevTools /json/new HTTP API in Chromium.
    Browserless mocks this payload so that remote clients can connect to the underlying "webSocketDebuggerUrl"
    which will cause Browserless to start the browser and proxy that request into a blank page.
  `);
  method = Methods.put;
  path = HTTPRoutes.jsonNew;
  tags = [APITags.browserAPI];

  async handler(_req: Request, res: Response): Promise<void> {
    const config = this.config();
    const externalAddress = config.getExternalWebSocketAddress();
    const id = pageID();
    const { protocol, host, pathname, href } = new URL(
      `/devtools/page/${id}`,
      externalAddress,
    );
    const param = protocol.includes('wss') ? 'wss' : 'ws';
    const value = path.join(host, pathname);

    return jsonResponse(res, 200, {
      description: '',
      devtoolsFrontendUrl: `/devtools/inspector.html?${param}=${value}`,
      id,
      title: 'New Tab',
      type: 'page',
      url: 'about:blank',
      webSocketDebuggerUrl: href,
    });
  }
}
