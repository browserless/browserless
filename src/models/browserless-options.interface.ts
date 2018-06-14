export interface IBrowserlessOptions {
  connectionTimeout: number;
  port: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  demoMode: boolean;
  enableDebugger: boolean;
  maxMemory: number;
  maxCPU: number;
  autoQueue: boolean;
  keepAlive: boolean;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  healthFailureURL: string | null;
}
