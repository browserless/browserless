import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  IBrowserlessMetricTotals,
  Methods,
  Request,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export type ResponseSchema = IBrowserlessMetricTotals;

const fiveMinuteIntervalsInAMonth = 8640;

export default class MetricsTotalGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.MetricsTotalGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Gets total metric details summed from the time the server started.`;
  method = Methods.get;
  path = HTTPManagementRoutes.metricsTotal;
  tags = [APITags.management];
  handler = async (_req: Request, res: ServerResponse): Promise<void> => {
    const fileSystem = this.fileSystem();
    const config = this.config();
    const metrics = (
      await fileSystem.read(config.getMetricsJSONPath(), false)
    ).map((m) => JSON.parse(m));
    const availableMetrics = metrics.length;
    const totals: IBrowserlessMetricTotals = metrics.reduce(
      (accum, metric) => ({
        error: accum.error + metric.error,
        estimatedMonthlyUnits: accum.estimatedMonthlyUnits,
        maxConcurrent: Math.max(accum.maxConcurrent, metric.maxConcurrent),
        maxTime: Math.max(accum.maxTime, metric.maxTime),
        meanTime: accum.meanTime + metric.meanTime,
        minTime: Math.min(accum.minTime, metric.minTime),
        minutesOfMetricsAvailable: accum.minutesOfMetricsAvailable + 5,
        queued: accum.queued + metric.queued,
        rejected: accum.rejected + metric.rejected,
        sessionTimes: [...accum.sessionTimes, ...metric.sessionTimes],
        successful: accum.successful + metric.successful,
        timedout: accum.timedout + metric.timedout,
        totalTime: accum.totalTime + metric.totalTime,
        unhealthy: accum.unhealthy + metric.unhealthy,
        units: accum.units + metric.units,
      }),
      {
        error: 0,
        estimatedMonthlyUnits: 0,
        maxConcurrent: 0,
        maxTime: 0,
        meanTime: 0,
        minTime: 0,
        minutesOfMetricsAvailable: 0,
        queued: 0,
        rejected: 0,
        sessionTimes: [],
        successful: 0,
        timedout: 0,
        totalTime: 0,
        unhealthy: 0,
        units: 0,
      },
    );

    totals.meanTime = totals.meanTime / metrics.length;
    totals.estimatedMonthlyUnits = Math.round(
      totals.units / (availableMetrics / fiveMinuteIntervalsInAMonth),
    );

    return writeResponse(res, 200, JSON.stringify(totals), contentTypes.json);
  };
}
