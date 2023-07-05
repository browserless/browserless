import { ServerResponse } from 'http';

import {
  contentTypes,
  Request,
  Methods,
  HTTPManagementRoutes,
  APITags,
} from '../../../http.js';

import { HTTPRoute } from '../../../types.js';
import * as util from '../../../utils.js';

export interface ResponseSchema {
  concurrent: number;
  data: string;
  debug: string;
  host: string;
  port: number;
  queued: number;
  retries: number;
  timeout: number;
}

const route: HTTPRoute = {
  accepts: [contentTypes.any],
  auth: true,
  browser: null,
  concurrency: false,
  contentTypes: [contentTypes.json],
  description: `Returns a JSON payload of the current system configuration.`,
  handler: async (_req: Request, res: ServerResponse): Promise<void> => {
    const { _config: getConfig } = route;

    if (!getConfig) {
      throw new util.ServerError(`Couldn't locate the config object`);
    }

    const config = getConfig();

    const response: ResponseSchema = {
      concurrent: config.getConcurrent(),
      data: await config.getDataDir(),
      debug: config.getDebug(),
      host: config.getHost(),
      port: config.getPort(),
      queued: config.getQueued(),
      retries: config.getRetries(),
      timeout: config.getTimeout(),
    };

    return util.jsonResponse(res, 200, response);
  },
  method: Methods.get,
  path: HTTPManagementRoutes.config,
  tags: [APITags.management],
};

export default route;
