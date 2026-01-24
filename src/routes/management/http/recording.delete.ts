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

export default class RecordingDeleteRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingDeleteRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Delete a session replay recording by ID.`;
  method = Methods.delete;
  path = HTTPManagementRoutes.recording;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    // Extract recording ID from path: /recordings/:id
    const pathParts = req.parsed.pathname.split('/');
    const id = pathParts[pathParts.length - 1];

    if (!id) {
      throw new NotFound('Recording ID is required');
    }

    const deleted = await replay.deleteRecording(id);
    if (!deleted) {
      throw new NotFound(`Recording "${id}" not found`);
    }

    return jsonResponse(res, 200, { deleted: true, id });
  }
}
