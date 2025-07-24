import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export type ResponseSchema = {
  pressure: {
    /**
     * An integer representing the percentage of CPU being used. For instance 92 means 92%
     */
    cpu: number | null;

    /**
     * A number of milliseconds since epoch, or "Date.now()" equivalent.
     */
    date: number;

    /**
     * Whether or not a session can be connected and immediately ran on a health instance.
     */
    isAvailable: boolean;

    /**
     * The maximum amount of browsers that can be ran at a single time.
     */
    maxConcurrent: number;

    /**
     * The maximum amount of queued connections allowed at a single time.
     */
    maxQueued: number;

    /**
     * An integer representing the percentage of Memory being used. For instance 95 means 95%
     */
    memory: number | null;

    /**
     * A human-readable message as the overall status of the instance.
     */
    message: string;

    /**
     * The current number of connect or API calls pending to run.
     */
    queued: number;

    /**
     * A simple single-word reason as to why an instance may or may not be available.
     */
    reason: 'full' | 'cpu' | 'memory' | '';

    /**
     * The number of recent connections that were rejected due to the queue and concurrency
     * limits having been filled.
     */
    recentlyRejected: number;

    /**
     * The current number of running connections or API calls.
     */
    running: number;
  };
};

export default class PressureGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.PressureGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON body of stats related to the pressure being created on the instance.`;
  method = Methods.get;
  path = HTTPManagementRoutes.pressure;
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const monitoring = this.monitoring();
    const config = this.config();
    const limiter = this.limiter();
    const metrics = this.metrics();

    const {
      cpuInt: cpu,
      memoryInt: memory,
      cpuOverloaded,
      memoryOverloaded,
    } = await monitoring.overloaded();
    const date = Date.now();
    const hasCapacity = limiter.hasCapacity;
    const queued = limiter.waiting;
    const isAvailable = hasCapacity && !cpuOverloaded && !memoryOverloaded;
    const running = limiter.executing;
    const recentlyRejected = metrics.get().rejected;
    const maxConcurrent = config.getConcurrent();
    const maxQueued = config.getQueued();

    const reason = !hasCapacity
      ? 'full'
      : cpuOverloaded
        ? 'cpu'
        : memoryOverloaded
          ? 'memory'
          : '';

    const message = !hasCapacity
      ? 'Concurrency and queue are full'
      : cpuOverloaded
        ? 'CPU is over the configured maximum for cpu percent'
        : memoryOverloaded
          ? 'Memory is over the configured maximum for memory percent'
          : '';

    const statusCode = !hasCapacity || cpuOverloaded || memoryOverloaded ? 503 : 200;

    const response: ResponseSchema = {
      pressure: {
        cpu,
        date,
        isAvailable,
        maxConcurrent,
        maxQueued,
        memory,
        message,
        queued,
        reason,
        recentlyRejected,
        running,
      },
    };

    return jsonResponse(res, statusCode, response);
  }
}
