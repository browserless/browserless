import {
  APITags,
  BrowserlessRoutes,
  HTTPRoute,
  HTTPRoutes,
  Logger,
  Methods,
  Request,
  Response,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = object;

export default class ChromiumJSONProtocolGetRoute extends HTTPRoute {
  protected cachedProtocol: object | undefined;

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

  async handler(_req: Request, res: Response, logger: Logger): Promise<void> {
    const browserManager = this.browserManager();

    if (!this.cachedProtocol) {
      this.cachedProtocol = await browserManager.getProtocolJSON(logger);
    }

    return jsonResponse(res, 200, this.cachedProtocol);
  }
}
