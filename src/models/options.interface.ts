export interface IBrowserlessOptions
  extends IBrowserlessServerConfiguration,
    IChromeServiceConfiguration {}

interface IBrowserlessServerConfiguration {
  host: string | undefined;
  port: number;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  errorAlertURL: string | null;
  healthFailureURL: string | null;
  metricsJSONPath: string | null;
  exitOnHealthFailure: boolean;
  workspaceDir: string;
}

export interface IChromeServiceConfiguration {
  connectionTimeout: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  demoMode: boolean;
  enableDebugger: boolean;
  enableDebugViewer: boolean;
  functionExternals: string[];
  functionBuiltIns: string[];
  maxMemory: number;
  maxCPU: number;
  keepAlive: boolean;
  chromeRefreshTime: number;
  maxChromeRefreshRetries: number;
  enableCors: boolean;
  enableXvfb: boolean;
  token: string | null;
}
