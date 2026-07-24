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
  getTokenFromRequest,
  jsonResponse,
  makeDevtoolsFrontendURL,
  makeExternalWebSocketURL,
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
    which will cause Browserless to start the browser and proxy that request into a blank page. The
    "webSocketDebuggerUrl" excludes API tokens, so authenticated clients must add their authorization when connecting.
    The "devtoolsFrontendUrl" remains directly usable and can contain the API token inside its nested WebSocket URL;
    treat this field as credential-bearing and redact query strings from proxy and access logs.
  `);
  method = Methods.put;
  path = HTTPRoutes.jsonNew;
  tags = [APITags.browserAPI];

  async handler(req: Request, res: Response): Promise<void> {
    const config = this.config();
    const externalAddress = config.getExternalWebSocketAddress();
    const id = pageID();
    const pagePath = `/devtools/page/${id}`;
    const webSocketURL = makeExternalWebSocketURL(externalAddress, pagePath);
    const token = getTokenFromRequest(req);
    const authorizedWebSocketURL = makeExternalWebSocketURL(
      externalAddress,
      pagePath,
      token,
    );
    const frontendURL = new URL(config.getExternalAddress());
    frontendURL.pathname = path.posix.join(
      frontendURL.pathname,
      '/devtools/inspector.html',
    );
    const devtoolsFrontendURL = makeDevtoolsFrontendURL(
      frontendURL,
      authorizedWebSocketURL,
    );

    return jsonResponse(res, 200, {
      description: '',
      devtoolsFrontendUrl:
        devtoolsFrontendURL.pathname + devtoolsFrontendURL.search,
      id,
      title: 'New Tab',
      type: 'page',
      url: 'about:blank',
      webSocketDebuggerUrl: webSocketURL.href,
    });
  }
}
