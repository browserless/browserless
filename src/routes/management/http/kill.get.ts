import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  ReplayCompleteParams,
  Request,
  SystemQueryParameters,
  contentTypes,
  getFinalPathSegment,
  jsonResponse,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export type ResponseSchema = ReplayCompleteParams[];

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
  browserId?: string;
  trackingId?: string;
}

export default class KillGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.KillGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Kill running sessions based on BrowserId or TrackingId.`;
  method = Methods.get;
  path = HTTPManagementRoutes.kill;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const target = getFinalPathSegment(req.parsed.pathname)!;
    const browserManager = this.browserManager();
    try {
      const recordings = await browserManager.killSessions(target);
      return jsonResponse(res, 200, recordings);
    } catch {
      return writeResponse(res, 404, '');
    }
  }
}
