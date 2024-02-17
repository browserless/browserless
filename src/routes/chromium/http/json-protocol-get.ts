import {
  APITags,
  HTTPRoute,
  HTTPRoutes,
  Methods,
  Request,
  Response,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';

// @TODO Figure out how to parse the Protocol JSON into a TS definition
// for our openapi docs.
export type ResponseSchema = object;

export default class GetJSONVersion extends HTTPRoute {
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns Protocol JSON meta-data that Chrome and Chromium come with.`;
  method = Methods.get;
  path = HTTPRoutes.jsonProtocol;
  tags = [APITags.browserAPI];

  private cachedProtocol: object | undefined;

  handler = async (_req: Request, res: Response): Promise<void> => {
    const browserManager = this.browserManager();

    if (!this.cachedProtocol) {
      this.cachedProtocol = await browserManager.getProtocolJSON();
    }

    return jsonResponse(res, 200, this.cachedProtocol);
  };
}
