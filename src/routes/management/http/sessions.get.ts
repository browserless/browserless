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
  getTokenFromRequest,
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
  description = `Lists all currently running sessions and relevant meta-data. Page entries can include a directly usable "devtoolsFrontendUrl" containing the API token inside its nested WebSocket URL; treat this field as credential-bearing and redact query strings from proxy and access logs.`;
  method = Methods.get;
  path = HTTPManagementRoutes.sessions;
  tags = [APITags.management];
  async handler(req: Request, res: ServerResponse): Promise<void> {
    const trackingId = (req.queryParams.trackingId as string) || undefined;
    const browserManager = this.browserManager();
    const response: ResponseSchema = await browserManager.getAllSessions(
      trackingId,
      getTokenFromRequest(req),
    );

    return jsonResponse(res, 200, response);
  }
}
