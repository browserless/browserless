import { ServerResponse } from 'http';

import {
  contentTypes,
  Methods,
  HTTPManagementRoutes,
  Request,
  APITags,
} from '../../../http.js';

import { HTTPRoute, IBrowserlessStats } from '../../../types.js';
import * as util from '../../../utils.js';

export type ResponseSchema = Array<IBrowserlessStats>;

const route: HTTPRoute = {
  accepts: [contentTypes.any],
  auth: true,
  browser: null,
  concurrency: false,
  contentTypes: [contentTypes.json],
  description: `Gets total metric details from the time the server started.`,
  handler: async (_req: Request, res: ServerResponse): Promise<void> => {
    const { _fileSystem, _config } = route;

    if (!_fileSystem || !_config) {
      throw new util.ServerError(
        `Couldn't locate the file-system or config module`,
      );
    }

    const fileSystem = _fileSystem();
    const config = _config();

    const stats = await fileSystem.read(config.getMetricsJSONPath());
    const response = `[${stats.join(',')}]`;

    return util.writeResponse(res, 200, response, contentTypes.json);
  },
  method: Methods.get,
  path: HTTPManagementRoutes.metrics,
  tags: [APITags.management],
};

export default route;
