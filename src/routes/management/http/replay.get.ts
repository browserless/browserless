import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Replay,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export type ResponseSchema = Replay;

export default class ReplayGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ReplayGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json, contentTypes.html];
  description = `Get a specific session replay by ID.`;
  method = Methods.get;
  path = HTTPManagementRoutes.replay;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    // Extract replay ID from path: /replays/:id
    const pathParts = req.parsed.pathname.split('/');
    const id = pathParts[pathParts.length - 1];

    if (!id) {
      throw new NotFound('Replay ID is required');
    }

    const result = await replay.getReplay(id);
    if (!result) {
      throw new NotFound(`Replay "${id}" not found`);
    }

    return jsonResponse(res, 200, result);
  }
}
