import {
  APITags,
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  CDPChromium,
  CDPLaunchOptions,
  HTTPRoutes,
  Methods,
  Request,
  ServerError,
  SystemQueryParameters,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

import main from '../utils/performance/main.js';

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

const route: BrowserHTTPRoute = {
  accepts: [contentTypes.json],
  auth: true,
  browser: CDPChromium,
  concurrency: true,
  contentTypes: [contentTypes.json],
  description: `Run lighthouse performance audits with a supplied "url" in your JSON payload.`,
  handler: async (
    req: Request,
    res: ServerResponse,
    browser: BrowserInstance,
  ): Promise<void> => {
    const { _config: getConfig } = route;
    if (!req.body) {
      throw new BadRequest(`No JSON body present`);
    }

    if (!getConfig) {
      throw new ServerError(`Couldn't load configuration for timeouts`);
    }
    const config = getConfig();
    const response = await main({
      browser,
      context: req.body as BodySchema,
      timeout: config.getTimeout(),
    });

    return jsonResponse(res, 200, response);
  },
  method: Methods.post,
  path: HTTPRoutes.performance,
  tags: [APITags.browserAPI],
};

export default route;
