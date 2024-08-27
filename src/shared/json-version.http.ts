import {
  APITags,
  BrowserManager,
  BrowserlessRoutes,
  HTTPRoute,
  HTTPRoutes,
  Logger,
  Methods,
  Request,
  Response,
  UnwrapPromise,
  contentTypes,
  jsonResponse,
  writeResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = UnwrapPromise<
  ReturnType<BrowserManager['getVersionJSON']>
>;

export default class ChromiumJSONVersionGetRoute extends HTTPRoute {
  protected cachedJSON: ResponseSchema | undefined;

  name = BrowserlessRoutes.ChromiumJSONVersionGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON payload that acts as a pass-through to the DevTools /json/version protocol in Chrome and Chromium.`;
  method = Methods.get;
  path = HTTPRoutes.jsonVersion;
  tags = [APITags.browserAPI];
  async handler(req: Request, res: Response, logger: Logger): Promise<void> {
    const baseUrl = req.parsed.host;
    const protocol = req.parsed.protocol.includes('s') ? 'wss' : 'ws';

    try {
      if (!this.cachedJSON) {
        const browserManager = this.browserManager();
        this.cachedJSON = {
          ...(await browserManager.getVersionJSON(logger)),
          webSocketDebuggerUrl: `${protocol}://${baseUrl}`,
        };
      }
      return jsonResponse(res, 200, this.cachedJSON);
    } catch (err) {
      logger.warn(`Error handling request`, err);
      return writeResponse(
        res,
        500,
        'There was an error handling your request',
        contentTypes.text,
      );
    }
  }
}
