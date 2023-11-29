import {
  APITags,
  BadRequest,
  BrowserlessSessionJSON,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

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
      throw new BadRequest(`Couldn't load browsers running`);
    }

    const response: ResponseSchema = await browserManager().getAllSessions(req);

    return jsonResponse(res, 200, response);
  },
  method: Methods.get,
  path: HTTPManagementRoutes.sessions,
  tags: [APITags.management],
};

export default route;
