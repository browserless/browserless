import { ServerResponse } from 'http';

import {
  contentTypes,
  Request,
  Methods,
  HTTPManagementRoutes,
  APITags,
} from '../../../http.js';

import { BrowserlessSessionJSON, HTTPRoute } from '../../../types.js';
import * as util from '../../../utils.js';

export type ResponseSchema = BrowserlessSessionJSON[];

const route: HTTPRoute = {
  accepts: [contentTypes.any],
  auth: true,
  browser: null,
  concurrency: false,
  contentTypes: [contentTypes.json],
  description: `Lists all currently running sessions and relevant meta-data excluding potentially open pages.`,
  handler: async (req: Request, res: ServerResponse): Promise<void> => {
    const { _browserManager: browserManager } = route;

    if (!browserManager) {
      throw new util.BadRequest(`Couldn't load browsers running`);
    }

    const token = util.getTokenFromRequest(req);

    if (!token) {
      throw new util.BadRequest(`Couldn't locate your API token`);
    }

    const response: ResponseSchema = await browserManager().getAllSessions();

    return util.jsonResponse(res, 200, response);
  },
  method: Methods.get,
  path: HTTPManagementRoutes.sessions,
  tags: [APITags.management],
};

export default route;
