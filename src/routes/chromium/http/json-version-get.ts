import {
  APITags,
  BrowserManager,
  HTTPRoutes,
  HTTPRoute,
  Methods,
  Request,
  Response,
  UnwrapPromise,
  contentTypes,
  jsonResponse,
  writeResponse,
} from '@browserless.io/browserless';

export type ResponseSchema = UnwrapPromise<ReturnType<BrowserManager['getVersionJSON']>>;

export default class GetJSONVersion extends HTTPRoute {
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON payload that acts as a pass-through to the DevTools /json/version protocol in Chrome.`;
  method = Methods.get;
  path = HTTPRoutes.jsonVersion;
  tags = [APITags.browserAPI];

  private cachedJSON: ResponseSchema | undefined;

  handler = async (req: Request, res: Response): Promise<void> => {
    const baseUrl = req.parsed.host;
    const protocol = req.parsed.protocol.includes('s') ? 'wss' : 'ws';
    const browserManager = this.browserManager();

    try {
      if (!this.cachedJSON) {
        this.cachedJSON = {
          ...(await browserManager.getVersionJSON()),
          webSocketDebuggerUrl: `${protocol}://${baseUrl}`,
        };
      }

      return jsonResponse(res, 200, this.cachedJSON);
    } catch (err) {
      return writeResponse(
        res,
        500,
        'There was an error handling your request',
        contentTypes.text,
      );
    }
  };
}
