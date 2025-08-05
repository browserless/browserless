import {
  APITags,
  BrowserlessRoutes,
  BrowserlessSessionJSON,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
  trackingId?: string;
}

export type ResponseSchema = BrowserlessSessionJSON[];

export default class SessionsGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.SessionsGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Lists all currently running sessions and relevant meta-data excluding potentially open pages.`;
  method = Methods.get;
  path = HTTPManagementRoutes.sessions;
  tags = [APITags.management];
  async handler(req: Request, res: ServerResponse): Promise<void> {
    const trackingId = (req.queryParams.trackingId as string) || undefined;
    const browserManager = this.browserManager();
    const response: ResponseSchema =
      await browserManager.getAllSessions(trackingId);

    return jsonResponse(res, 200, response);
  }
}
