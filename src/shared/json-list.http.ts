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
} from '@browserless.io/browserless';

export type ResponseSchema = Array<CDPJSONPayload>;

export default class ChromiumJSONListGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ChromiumJSONListGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = dedent(`
    Returns a JSON payload that acts as a pass-through to the DevTools /json/list HTTP API in Chromium and Chrome.
    Browserless crafts this payload so that remote clients can connect to the underlying "webSocketDebuggerUrl"
    properly, excluding any API tokens in that URL. If under authentication be sure to include your authorization.
  `);
  method = Methods.get;
  path = HTTPRoutes.jsonList;
  tags = [APITags.browserAPI];

  async handler(_req: Request, res: Response): Promise<void> {
    const browserManage = this.browserManager();
    return jsonResponse(res, 200, await browserManage.getJSONList());
  }
}
