import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export interface ResponseSchema {
  deleted: boolean;
  id: string;
}

export default class ReplayDataDeleteRoute extends HTTPRoute {
  name = BrowserlessRoutes.ReplayDataDeleteRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Delete a session replay by ID.`;
  method = Methods.delete;
  path = HTTPManagementRoutes.replayData;
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

    const deleted = await replay.deleteReplay(id);
    if (!deleted) {
      throw new NotFound(`Replay "${id}" not found`);
    }

    return jsonResponse(res, 200, { deleted: true, id });
  }
}
