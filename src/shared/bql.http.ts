import {
  APITags,
  HTTPRoutes,
  Methods,
  Request,
  SystemQueryParameters,
  contentTypes,
} from '../http.js';
import {
  BrowserHTTPRoute,
  BrowserlessRoutes,
  CDPLaunchOptions,
} from '../types.js';
import { ChromiumCDP } from '../browsers/browsers.cdp.js';
import type { Logger } from '../logger.js';
import type { ServerResponse } from 'node:http';
import { handleBQLHTTP } from '../bql/http.js';

export { BodySchema, ResponseSchema } from '../bql/http.js';
export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

export default class ChromiumBQLPostRoute extends BrowserHTTPRoute<ChromiumCDP> {
  name = BrowserlessRoutes.ChromiumBQLPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.chromiumBQL];
  tags = [APITags.BQL];
  auth = true;
  concurrency = true;
  accepts = [contentTypes.json];
  contentTypes = [contentTypes.json];
  method = Methods.post;
  description = 'Execute a BrowserQL operation in a browser session.';

  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
    browser: ChromiumCDP,
  ): Promise<void> {
    return handleBQLHTTP(req, res, browser, this.bql(), {
      config: this.config(),
      logger,
    });
  }
}
