import {
  APITags,
  HTTPManagementRoutes,
  Methods,
  Request,
  contentTypes,
} from '../../../http.js';
import { BrowserlessRoutes, HTTPRoute } from '../../../types.js';
import { dedent, writeResponse } from '../../../utils.js';

import { ServerResponse } from 'http';

export default class ActiveGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ActiveGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.text];
  description = dedent(`
    Returns a simple "204" HTTP code, with no response, indicating that the service itself is up and running.
    Useful for liveliness probes or other external checks.
  `);
  method = Methods.get;
  path = HTTPManagementRoutes.active;
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    return writeResponse(res, 204, '', contentTypes.text);
  }
}
