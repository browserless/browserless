import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  SystemQueryParameters,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
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
    const target = req.parsed.pathname.split('/')[2];
    const browserManager = this.browserManager();
    await browserManager.killSessions(target);
    return writeResponse(res, 204, '');
  }
}
