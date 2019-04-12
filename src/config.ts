import * as os from 'os';

const parseJSONParam = (param: string | undefined, defaultParam: number | boolean | string[]) => {
  if (param) {
    try {
      return JSON.parse(param);
    } catch (err) {
      console.warn(`Couldn't parse parameter: "${param}". Saw error "${err}"`);
      return defaultParam;
    }
  }
  return defaultParam;
};

const thirtyMinutes = 30 * 60 * 1000;

export const CONNECTION_TIMEOUT: number =         parseJSONParam(process.env.CONNECTION_TIMEOUT, 30000);
export const MAX_CONCURRENT_SESSIONS: number =    parseJSONParam(process.env.MAX_CONCURRENT_SESSIONS, 10);
export const QUEUE_LENGTH: number =               parseJSONParam(process.env.MAX_QUEUE_LENGTH, 10);
export const PORT: number =                       parseJSONParam(process.env.PORT, 8080);
export const PREBOOT_CHROME: boolean =            parseJSONParam(process.env.PREBOOT_CHROME, false);
export const DEMO_MODE: boolean =                 parseJSONParam(process.env.DEMO_MODE, false);
export const ENABLE_DEBUG_VIEWER: boolean =       parseJSONParam(process.env.ENABLE_DEBUG_VIEWER, true);
export const ENABLE_DEBUGGER: boolean =           parseJSONParam(process.env.ENABLE_DEBUGGER, true);
export const MAX_MEMORY_PERCENT: number =         parseJSONParam(process.env.MAX_MEMORY_PERCENT, 99);
export const MAX_CPU_PERCENT: number =            parseJSONParam(process.env.MAX_CPU_PERCENT, 99);
export const KEEP_ALIVE: boolean =                parseJSONParam(process.env.KEEP_ALIVE, false);
export const CHROME_REFRESH_TIME: number =        parseJSONParam(process.env.CHROME_REFRESH_TIME, thirtyMinutes);
export const MAX_CHROME_REFRESH_RETRIES: number = parseJSONParam(process.env.MAX_CHROME_REFRESH_RETRIES, 5);
export const ENABLE_CORS: boolean  =              parseJSONParam(process.env.ENABLE_CORS, false);
export const ENABLE_XVBF: boolean =               parseJSONParam(process.env.ENABLE_XVBF, false);
export const EXIT_ON_HEALTH_FAILURE: boolean =    parseJSONParam(process.env.EXIT_ON_HEALTH_FAILURE, false);
export const HOST: string | undefined =           process.env.HOST;
export const TOKEN: string | null =               process.env.TOKEN || null;
export const QUEUE_ALERT_URL: string | null =     process.env.QUEUE_ALERT_URL || null;
export const REJECT_ALERT_URL: string | null =    process.env.REJECT_ALERT_URL || null;
export const TIMEOUT_ALERT_URL: string | null =   process.env.TIMEOUT_ALERT_URL || null;
export const FAILED_HEALTH_URL: string | null =   process.env.FAILED_HEALTH_URL || null;
export const METRICS_JSON_PATH: string | null =   process.env.METRICS_JSON_PATH || null;
export const FUNCTION_BUILT_INS: string[] =       parseJSONParam(process.env.FUNCTION_BUILT_INS, []);
export const FUNCTION_EXTERNALS: string[] =       parseJSONParam(process.env.FUNCTION_EXTERNALS, []);
export const WORKSPACE_DIR: string =              process.env.WORKSPACE_DIR ? process.env.WORKSPACE_DIR : os.tmpdir();
export const DEBUG: string | undefined =          process.env.DEBUG;
export const MAX_PAYLOAD_SIZE: string =           process.env.MAX_PAYLOAD_SIZE || '5mb';
