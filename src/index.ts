import { Chrome } from './Chrome';

const parseParam = (param:any, defaultParam:any) => {
  if (param) {
    return JSON.parse(param);
  }
  return defaultParam;
}

const connectionTimeout =      parseParam(process.env.CONNECTION_TIMEOUT, 30000);
const maxConcurrentSessions =  parseParam(process.env.MAX_CONCURRENT_SESSIONS, 10);
const maxQueueLength =         parseParam(process.env.MAX_QUEUE_LENGTH, 10);
const port =                   parseParam(process.env.PORT, 8080);
const prebootChrome =          parseParam(process.env.PREBOOT_CHROME, false);
const token =                  process.env.TOKEN || null;
const queuedAlertURL =         process.env.QUEUE_ALERT_URL || null;
const rejectAlertURL =         process.env.REJECT_ALERT_URL || null;
const timeoutAlertURL =        process.env.TIMEOUT_ALERT_URL || null;
const healthFailureURL =       process.env.FAILED_HEALTH_URL || null;

new Chrome({
  token,
  connectionTimeout,
  maxConcurrentSessions,
  maxQueueLength,
  port,
  prebootChrome,
  queuedAlertURL,
  rejectAlertURL,
  timeoutAlertURL,
  healthFailureURL,
})
.startServer();
