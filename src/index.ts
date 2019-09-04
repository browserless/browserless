import { BrowserlessServer } from './browserless';
import * as config from './config';

const browserless = new BrowserlessServer({
  chromeRefreshTime: config.CHROME_REFRESH_TIME,
  connectionTimeout: config.CONNECTION_TIMEOUT,
  demoMode: config.DEMO_MODE,
  enableCors: config.ENABLE_CORS,
  enableDebugViewer: config.ENABLE_DEBUG_VIEWER,
  enableDebugger: config.ENABLE_DEBUGGER,
  enableXvfb: config.ENABLE_XVBF,
  errorAlertURL: config.ERROR_ALERT_URL,
  exitOnHealthFailure: config.EXIT_ON_HEALTH_FAILURE,
  functionBuiltIns: config.FUNCTION_BUILT_INS,
  functionExternals: config.FUNCTION_EXTERNALS,
  healthFailureURL: config.FAILED_HEALTH_URL,
  host: config.HOST,
  keepAlive: config.KEEP_ALIVE,
  maxCPU: config.MAX_CPU_PERCENT,
  maxChromeRefreshRetries: config.MAX_CHROME_REFRESH_RETRIES,
  maxConcurrentSessions: config.MAX_CONCURRENT_SESSIONS,
  maxMemory: config.MAX_MEMORY_PERCENT,
  maxQueueLength: config.QUEUE_LENGTH + config.MAX_CONCURRENT_SESSIONS,
  metricsJSONPath: config.METRICS_JSON_PATH,
  port: config.PORT,
  prebootChrome: config.PREBOOT_CHROME,
  queuedAlertURL: config.QUEUE_ALERT_URL,
  rejectAlertURL: config.REJECT_ALERT_URL,
  timeoutAlertURL: config.TIMEOUT_ALERT_URL,
  token: config.TOKEN,
  workspaceDir: config.WORKSPACE_DIR,
});

browserless.startServer();

if (module.parent) {
  module.exports.browserless = browserless;
}
