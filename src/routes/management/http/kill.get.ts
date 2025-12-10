import { BrowserlessRoutes, HTTPRoute } from '../../../types.js';
import {
  APITags,
  HTTPManagementRoutes,
  Methods,
  Request,
  SystemQueryParameters,
  contentTypes,
} from '../../../http.js';
import { getFinalPathSegment, writeResponse } from '../../../utils.js';
import { ServerResponse } from 'http';

export type ResponseSchema = string;

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
    await browserManager.killSessions(target);
    return writeResponse(res, 204, '');
  }
}
