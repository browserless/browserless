import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  RecordingMetadata,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export type ResponseSchema = RecordingMetadata[];

export default class RecordingsGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingsGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Lists all saved session replay recordings.`;
  method = Methods.get;
  path = HTTPManagementRoutes.recordings;
  tags = [APITags.management];

  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    const recordings = await replay.listRecordings();
    return jsonResponse(res, 200, recordings);
  }
}
