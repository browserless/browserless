export interface IBrowserlessOptions
  extends IBrowserlessServerConfiguration,
    IChromeServiceConfiguration {}

export interface IBrowserlessServerConfiguration {
  port: number;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  healthFailureURL: string | null;
}

export interface IChromeServiceConfiguration {
  connectionTimeout: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  demoMode: boolean;
  enableDebugger: boolean;
  maxMemory: number;
  maxCPU: number;
  autoQueue: boolean;
  keepAlive: boolean;
  chromeRefreshTime: number;
  maxChromeRefreshRetries: number;
}
