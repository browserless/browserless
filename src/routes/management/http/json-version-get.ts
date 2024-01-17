import { ServerResponse } from 'http';

import {
  APITags,
  HTTPManagementRoutes,
  Methods,
  Request,
  contentTypes,
} from '../../../http.js';

import { HTTPRoute } from '../../../types.js';

import * as util from '../../../utils.js';

export type ResponseSchema = {
  Browser: string;
  'Debugger-Version': string;
  'Protocol-Version': string;
  'User-Agent': string;
  'V8-Version': string;
  'WebKit-Version': string;
  webSocketDebuggerUrl: string;
};

export default class GetJSONVersion extends HTTPRoute {
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON payload that acts as a pass-through to the DevTools /json/version protocol in Chrome.`;
  method = Methods.get;
  path = HTTPManagementRoutes.jsonVersion;
  tags = [APITags.management];

  private cachedJSON: ResponseSchema | undefined;

  handler = async (req: Request, res: ServerResponse): Promise<void> => {
    const baseUrl = req.parsed.host;
    const protocol = req.parsed.protocol.includes('s') ? 'wss' : 'ws';

    if (!this.browserManager()) {
      throw new util.BadRequest(`Couldn't load browsers running`);
    }

    try {
      if (!this.cachedJSON) {
        this.cachedJSON = {
          ...(await this.browserManager().getVersionJSON()),
          webSocketDebuggerUrl: `${protocol}://${baseUrl}`,
        };
      }

      return util.jsonResponse(res, 200, this.cachedJSON);
    } catch (err) {
      return util.writeResponse(
        res,
        500,
        'There was an error handling your request',
        contentTypes.text,
      );
    }
  };
}
