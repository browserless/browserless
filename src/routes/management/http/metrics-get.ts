import {
  APITags,
  HTTPManagementRoutes,
  HTTPRoute,
  IBrowserlessStats,
  Methods,
  Request,
  ServerError,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

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
      throw new ServerError(`Couldn't locate the file-system or config module`);
    }

    const fileSystem = _fileSystem();
    const config = _config();

    const stats = await fileSystem.read(config.getMetricsJSONPath());
    const response = `[${stats.join(',')}]`;

    return writeResponse(res, 200, response, contentTypes.json);
  },
  method: Methods.get,
  path: HTTPManagementRoutes.metrics,
  tags: [APITags.management],
};

export default route;
