function parseParam(param:any, defaultParam:any) {
  if (param) {
    return JSON.parse(param);
  }
  return defaultParam;
}

export const port =                   parseParam(process.env.PORT, 8080);
export const maxQueueLength =         parseParam(process.env.MAX_QUEUE_LENGTH, 10);
export const connectionTimeout =      parseParam(process.env.CONNECTION_TIMEOUT, 30000);
export const maxConcurrentSessions =  parseParam(process.env.MAX_CONCURRENT_SESSIONS, 10);
