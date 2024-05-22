import {
  APITags,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  HTTPRoutes,
  Logger,
  Methods,
  Request,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

import main from './utils/performance/main.js';

export interface BodySchema {
  budgets?: Array<object>;
  config?: object;
  url: string;
}

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

/**
 * The response of the lighthouse stats. Response objects are
 * determined by the type of budgets and config in the POST
 * JSON body
 */
export type ResponseSchema = object;

export default class PerformancePost extends BrowserHTTPRoute {
  name = BrowserlessRoutes.ChromiumPerformancePostRoute;
  accepts = [contentTypes.json];
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  contentTypes = [contentTypes.json];
  description = `Run lighthouse performance audits with a supplied "url" in your JSON payload.`;
  method = Methods.post;
  path = [HTTPRoutes.performance, HTTPRoutes.chromiumPerformance];
  tags = [APITags.browserAPI];
  async handler(
    req: Request,
    res: ServerResponse,
    _logger: Logger,
    browser: BrowserInstance,
  ): Promise<void> {
    const config = this.config();
    const response = await main({
      browser,
      context: req.body as BodySchema,
      logger: _logger,
      timeout: config.getTimeout(),
    });

    return jsonResponse(res, 200, response);
  }
}
