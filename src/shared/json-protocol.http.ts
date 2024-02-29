import {
  APITags,
  BrowserlessRoutes,
  HTTPRoute,
  HTTPRoutes,
  Methods,
  Request,
  Response,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = object;

export default class ChromiumJSONProtocolGetRoute extends HTTPRoute {
  private cachedProtocol: object | undefined;

  name = BrowserlessRoutes.ChromiumJSONProtocolGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns Protocol JSON meta-data that Chrome and Chromium come with.`;
  method = Methods.get;
  path = HTTPRoutes.jsonProtocol;
  tags = [APITags.browserAPI];

  handler = async (_req: Request, res: Response): Promise<void> => {
    const browserManager = this.browserManager();

    if (!this.cachedProtocol) {
      this.cachedProtocol = await browserManager.getProtocolJSON();
    }

    return jsonResponse(res, 200, this.cachedProtocol);
  };
}
