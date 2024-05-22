import {
  APITags,
  BrowserlessRoutes,
  BrowserlessSessionJSON,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

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
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const browserManager = this.browserManager();
    const response: ResponseSchema = await browserManager.getAllSessions();

    return jsonResponse(res, 200, response);
  }
}
