import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  ReplayMetadata,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export type ResponseSchema = ReplayMetadata[];

export default class ReplaysGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ReplaysGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Lists all saved session replays.`;
  method = Methods.get;
  path = HTTPManagementRoutes.replays;
  tags = [APITags.management];

  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    const replays = await replay.listReplays();
    return jsonResponse(res, 200, replays);
  }
}
