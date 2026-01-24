import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Recording,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export type ResponseSchema = Recording;

export default class RecordingGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json, contentTypes.html];
  description = `Get a specific session replay recording by ID.`;
  method = Methods.get;
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

    const recording = await replay.getRecording(id);
    if (!recording) {
      throw new NotFound(`Recording "${id}" not found`);
    }

    return jsonResponse(res, 200, recording);
  }
}
