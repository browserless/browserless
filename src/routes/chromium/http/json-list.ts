import {
  APITags,
  HTTPRoute,
  HTTPRoutes,
  Methods,
  Request,
  Response,
  contentTypes,
  dedent,
  jsonResponse,
} from '@browserless.io/browserless';
import { getCDPJSONPayload } from '../utils/cdp.js';

/*
Example Payload from Chromium:
  [{
    "description": "",
    "devtoolsFrontendUrl": "/devtools/inspector.html?ws=localhost:9222/devtools/page/6CA38A3E207BA534C674D1057B19E9CC",
    "id": "6CA38A3E207BA534C674D1057B19E9CC",
    "title": "New Tab",
    "type": "page",
    "url": "http://localhost:9222/json/list",
    "webSocketDebuggerUrl": "ws://localhost:9222/devtools/page/6CA38A3E207BA534C674D1057B19E9CC"
  }]
*/
export type ResponseSchema = Array<ReturnType<typeof getCDPJSONPayload>>;

export default class GetJSONList extends HTTPRoute {
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = dedent(`
    Returns a JSON payload that acts as a pass-through to the DevTools /json/list HTTP API in Chromium.
    Browserless mocks this payload so that remote clients can connect to the underlying "webSocketDebuggerUrl"
    which will cause Browserless to start the browser and proxy that request into a blank page.
  `);
  method = Methods.get;
  path = HTTPRoutes.jsonList;
  tags = [APITags.browserAPI];

  handler = async (_req: Request, res: Response): Promise<void> => {
    const config = this.config();
    const externalAddress = config.getExternalAddress();
    const payload = getCDPJSONPayload(externalAddress);

    return jsonResponse(res, 200, [payload] as ResponseSchema);
  };
}
