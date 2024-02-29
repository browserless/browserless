import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  IBrowserlessStats,
  Methods,
  Request,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export type ResponseSchema = Array<IBrowserlessStats>;

export default class MetricsGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.MetricsGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Gets total metric details from the time the server started.`;
  method = Methods.get;
  path = HTTPManagementRoutes.metrics;
  tags = [APITags.management];
  handler = async (_req: Request, res: ServerResponse): Promise<void> => {
    const fileSystem = this.fileSystem();
    const config = this.config();

    const stats = await fileSystem.read(config.getMetricsJSONPath());
    const response = `[${stats.join(',')}]`;

    return writeResponse(res, 200, response, contentTypes.json);
  };
}
