import {
  APITags,
  BrowserlessRoutes,
  CDPJSONPayload,
  HTTPRoute,
  HTTPRoutes,
  JSON_NEW_TARGET_PARAM,
  Methods,
  Request,
  Response,
  assertNavigationAllowed,
  contentTypes,
  dedent,
  jsonResponse,
  pageID,
  parseJSONNewTarget,
  resolveJSONNewTarget,
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

  async handler(req: Request, res: Response): Promise<void> {
    const config = this.config();

    // Read the request target as it arrived. Both request shims round-trip the
    // query through URLSearchParams before a route sees it, and re-serialising
    // a valueless key rewrites `?http://one.com` as `?http://one.com=`, which
    // then parses as the host `one.com=`.
    const rawURL = req.rawUrl ?? req.url ?? '';
    const queryStart = rawURL.indexOf('?');
    const requested =
      queryStart === -1 ? null : parseJSONNewTarget(rawURL.slice(queryStart));
    const target = requested ? resolveJSONNewTarget(requested) : null;
    assertNavigationAllowed(
      target ?? undefined,
      config.getBlockedURLPatterns(),
      config.getBlockedNetworkRanges(),
      config.getSelfNavigationHosts(),
    );

    const externalAddress = config.getExternalWebSocketAddress();
    const id = pageID();
    const { protocol, host, pathname, href } = new URL(
      `/devtools/page/${id}`,
      externalAddress,
    );
    const param = protocol.includes('wss') ? 'wss' : 'ws';
    const value = path.join(host, pathname);

    // The page does not exist yet — browserless only creates it once the
    // client connects to webSocketDebuggerUrl. That URL is therefore the only
    // channel able to carry the target across to the request that acts on it.
    const webSocketDebuggerUrl = new URL(href);
    if (target) {
      webSocketDebuggerUrl.searchParams.set(JSON_NEW_TARGET_PARAM, target);
    }

    return jsonResponse(res, 200, {
      description: '',
      devtoolsFrontendUrl: `/devtools/inspector.html?${param}=${value}`,
      id,
      title: 'New Tab',
      type: 'page',
      url: target ?? 'about:blank',
      webSocketDebuggerUrl: webSocketDebuggerUrl.href,
    });
  }
}
