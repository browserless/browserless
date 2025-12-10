import {
  BrowserlessRoutes,
  HTTPRoute,
  IBrowserlessStats,
} from '../../../types.js';
import {
  APITags,
  HTTPManagementRoutes,
  Methods,
  Request,
  contentTypes,
} from '../../../http.js';
import { writeResponse } from '../../../utils.js';
import { ServerResponse } from 'http';

export type ResponseSchema = Array<IBrowserlessStats>;

export default class MetricsGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.MetricsGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a list of metric details as far back as possible.`;
  method = Methods.get;
  path = HTTPManagementRoutes.metrics;
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const fileSystem = this.fileSystem();
    const config = this.config();

    const stats = await fileSystem.read(config.getMetricsJSONPath(), false);
    const response = `[${stats.join(',')}]`;

    return writeResponse(res, 200, response, contentTypes.json);
  }
}
