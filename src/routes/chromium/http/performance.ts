/* eslint-disable @typescript-eslint/ban-types */
import { ServerResponse } from 'http';

import { CDPChromium } from '../../../browsers/cdp-chromium.js';
import {
  contentTypes,
  SystemQueryParameters,
  Request,
  Methods,
  HTTPRoutes,
  APITags,
} from '../../../http.js';
import {
  BrowserHTTPRoute,
  BrowserInstance,
  CDPLaunchOptions,
} from '../../../types.js';
import * as util from '../../../utils.js';

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
      throw new util.BadRequest(`No JSON body present`);
    }

    if (!getConfig) {
      throw new util.ServerError(`Couldn't load configuration for timeouts`);
    }
    const config = getConfig();
    const response = await main({
      browser,
      context: req.body as BodySchema,
      timeout: config.getTimeout(),
    });

    return util.jsonResponse(res, 200, response);
  },
  method: Methods.post,
  path: HTTPRoutes.performance,
  tags: [APITags.browserAPI],
};

export default route;
