export interface IBrowserlessOptions
  extends IBrowserlessServerConfiguration,
    IChromeServiceConfiguration {}

export interface IBrowserlessServerConfiguration {
  host: string | undefined;
  port: number;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  healthFailureURL: string | null;
  metricsJSONPath: string | null;
}

export interface IChromeServiceConfiguration {
  connectionTimeout: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  demoMode: boolean;
  enableDebugger: boolean;
  functionExternals: string[];
  functionBuiltIns: string[];
  maxMemory: number;
  maxCPU: number;
  keepAlive: boolean;
  chromeRefreshTime: number;
  maxChromeRefreshRetries: number;
  enableCors: boolean;
  token: string | null;
  useChromeStable: boolean;
}
