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

export interface ResponseSchema {
  allowCORS: boolean;
  allowFileProtocol: boolean;
  allowGetCalls: boolean;
  concurrent: number;
  data: string;
  debug: string;
  errorAlertURL: string | null;
  healthFailureURL: string | null;
  host: string;
  maxCPU: number;
  maxMemory: number;
  metricsJSONPath: string;
  port: number;
  queued: number;
  queuedAlertURL: string | null;
  rejectAlertURL: string | null;
  retries: number;
  timeout: number;
  timeoutAlertURL: string | null;
  token: string | null;
}

export default class ConfigGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ConfigGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON payload of the current system configuration.`;
  method = Methods.get;
  path = HTTPManagementRoutes.config;
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const config = this.config();

    const response: ResponseSchema = {
      allowCORS: config.getAllowCORS(),
      allowFileProtocol: config.getAllowFileProtocol(),
      allowGetCalls: config.getAllowGetCalls(),
      concurrent: config.getConcurrent(),
      data: await config.getDataDir(),
      debug: config.getDebug(),
      errorAlertURL: config.getErrorAlertURL(),
      healthFailureURL: config.getFailedHealthURL(),
      host: config.getHost(),
      maxCPU: config.getCPULimit(),
      maxMemory: config.getMemoryLimit(),
      metricsJSONPath: config.getMetricsJSONPath(),
      port: config.getPort(),
      queued: config.getQueued(),
      queuedAlertURL: config.getQueueAlertURL(),
      rejectAlertURL: config.getRejectAlertURL(),
      retries: config.getRetries(),
      timeout: config.getTimeout(),
      timeoutAlertURL: config.getTimeoutAlertURL(),
      token: config.getToken(),
    };

    return jsonResponse(res, 200, response);
  }
}
