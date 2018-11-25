import { BrowserlessServer } from './browserless-web-server';
import { getDebug } from './utils';

const debug = getDebug('system');

const parseParam = (param: any, defaultParam: any) => {
  if (param) {
    try {
      return JSON.parse(param);
    } catch (err) {
      debug(`Couldn't parse parameter: "${param}". Saw error "${err}"`);
      return defaultParam;
    }
  }
  return defaultParam;
};

const thirtyMinutes = 30 * 60 * 1000;

const connectionTimeout =       parseParam(process.env.CONNECTION_TIMEOUT, 30000);
const maxConcurrentSessions =   parseParam(process.env.MAX_CONCURRENT_SESSIONS, 10);
const queueLength =             parseParam(process.env.MAX_QUEUE_LENGTH, 10);
const port =                    parseParam(process.env.PORT, 8080);
const prebootChrome =           parseParam(process.env.PREBOOT_CHROME, false);
const demoMode =                parseParam(process.env.DEMO_MODE, false);
const enableDebugger =          parseParam(process.env.ENABLE_DEBUGGER, true);
const maxMemory =               parseParam(process.env.MAX_MEMORY_PERCENT, 99);
const maxCPU =                  parseParam(process.env.MAX_CPU_PERCENT, 99);
const keepAlive =               parseParam(process.env.KEEP_ALIVE, false);
const chromeRefreshTime =       parseParam(process.env.CHROME_REFRESH_TIME, thirtyMinutes);
const maxChromeRefreshRetries = parseParam(process.env.MAX_CHROME_REFRESH_RETRIES, 5);
const enableCors =              parseParam(process.env.ENABLE_CORS, false);
const enableXvfb =              parseParam(process.env.ENABLE_XVBF, false);
const host =                    process.env.HOST;
const token =                   process.env.TOKEN || null;
const queuedAlertURL =          process.env.QUEUE_ALERT_URL || null;
const rejectAlertURL =          process.env.REJECT_ALERT_URL || null;
const timeoutAlertURL =         process.env.TIMEOUT_ALERT_URL || null;
const healthFailureURL =        process.env.FAILED_HEALTH_URL || null;
const metricsJSONPath =         process.env.METRICS_JSON_PATH || null;
const functionBuiltIns =        parseParam(process.env.FUNCTION_BUILT_INS, []);
const functionExternals =       parseParam(process.env.FUNCTION_EXTERNALS, []);

const maxQueueLength = queueLength + maxConcurrentSessions;

new BrowserlessServer({
  chromeRefreshTime,
  connectionTimeout,
  demoMode,
  enableCors,
  enableDebugger,
  enableXvfb,
  functionBuiltIns,
  functionExternals,
  healthFailureURL,
  host,
  keepAlive,
  maxCPU,
  maxChromeRefreshRetries,
  maxConcurrentSessions,
  maxMemory,
  maxQueueLength,
  metricsJSONPath,
  port,
  prebootChrome,
  queuedAlertURL,
  rejectAlertURL,
  timeoutAlertURL,
  token,
})
.startServer();
