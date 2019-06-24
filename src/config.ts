import * as fs from 'fs';
import * as os from 'os';
import * as puppeteer from 'puppeteer';

const debug = require('debug');
const packageJson = require('puppeteer/package.json');

// Required, by default, to make certain API's work
const REQUIRED_INTERNALS = ['url'];
const REQUIRED_EXTERNALS = ['lighthouse', 'node-pdftk'];
const IS_DOCKER = fs.existsSync('/.dockerenv');
const CHROME_BINARY_DEFAULT_LOCATION = '/usr/bin/google-chrome';

const getDebug = () => {
  if (typeof process.env.DEBUG !== 'undefined') {
    return process.env.DEBUG;
  }

  if (process.env.CI) {
    return process.env.DEBUG;
  }

  process.env.DEBUG = 'browserless*';
  debug.enable(process.env.DEBUG);
  return process.env.DEBUG;
};

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

// Timers/Queue/Concurrency
export const CHROME_REFRESH_TIME: number = parseJSONParam(process.env.CHROME_REFRESH_TIME, thirtyMinutes);
export const CONNECTION_TIMEOUT: number = parseJSONParam(process.env.CONNECTION_TIMEOUT, 30000);
export const MAX_CONCURRENT_SESSIONS: number = parseJSONParam(process.env.MAX_CONCURRENT_SESSIONS, 10);
export const QUEUE_LENGTH: number = parseJSONParam(process.env.MAX_QUEUE_LENGTH, 10);

// Preboot/Default Launch Options
export const KEEP_ALIVE: boolean = parseJSONParam(process.env.KEEP_ALIVE, false);
export const MAX_CHROME_REFRESH_RETRIES: number = parseJSONParam(process.env.MAX_CHROME_REFRESH_RETRIES, 5);
export const DEFAULT_BLOCK_ADS: boolean = parseJSONParam(process.env.DEFAULT_BLOCK_ADS, false);
export const DEFAULT_HEADLESS: boolean = parseJSONParam(process.env.DEFAULT_CHROME, true);
export const DEFAULT_LAUNCH_ARGS: string[] = parseJSONParam(process.env.DEFAULT_LAUNCH_ARGS, []);
export const DEFAULT_IGNORE_DEFAULT_ARGS: boolean = parseJSONParam(process.env.DEFAULT_IGNORE_DEFAULT_ARGS, false);
export const DEFAULT_IGNORE_HTTPS_ERRORS: boolean = parseJSONParam(process.env.DEFAULT_IGNORE_HTTPS_ERRORS, false);
export const DEFAULT_USER_DATA_DIR: string | undefined = process.env.DEFAULT_USER_DATA_DIR;
export const PREBOOT_CHROME: boolean = parseJSONParam(process.env.PREBOOT_CHROME, false);
export const CHROME_BINARY_LOCATION: string = (() => {
  // If it's installed already (docker) use it
  if (IS_DOCKER && fs.existsSync(CHROME_BINARY_DEFAULT_LOCATION)) {
    return CHROME_BINARY_DEFAULT_LOCATION;
  } else {
    // Use puppeteer's copy otherwise
    const browserFetcher = puppeteer.createBrowserFetcher();

    return browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision).executablePath;
  }
})();

// Security and accessibility
export const DEBUG: string | undefined = getDebug();
export const DEMO_MODE: boolean = parseJSONParam(process.env.DEMO_MODE, false);
export const ENABLE_CORS: boolean  = parseJSONParam(process.env.ENABLE_CORS, false);
export const ENABLE_DEBUGGER: boolean = parseJSONParam(process.env.ENABLE_DEBUGGER, true);
export const ENABLE_DEBUG_VIEWER: boolean = parseJSONParam(process.env.ENABLE_DEBUG_VIEWER, true);
export const ENABLE_XVBF: boolean = parseJSONParam(process.env.ENABLE_XVBF, false);
export const TOKEN: string | null = process.env.TOKEN || null;

// Puppeteer behavior
export const DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR = parseJSONParam(process.env.DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR, false);
export const FUNCTION_BUILT_INS: string[] = parseJSONParam(process.env.FUNCTION_BUILT_INS, REQUIRED_INTERNALS);
export const FUNCTION_EXTERNALS: string[] = parseJSONParam(process.env.FUNCTION_EXTERNALS, REQUIRED_EXTERNALS);
export const WORKSPACE_DIR: string = process.env.WORKSPACE_DIR ? process.env.WORKSPACE_DIR : os.tmpdir();

// Webhooks
export const FAILED_HEALTH_URL: string | null = process.env.FAILED_HEALTH_URL || null;
export const QUEUE_ALERT_URL: string | null = process.env.QUEUE_ALERT_URL || null;
export const REJECT_ALERT_URL: string | null = process.env.REJECT_ALERT_URL || null;
export const TIMEOUT_ALERT_URL: string | null = process.env.TIMEOUT_ALERT_URL || null;

// Health
export const EXIT_ON_HEALTH_FAILURE: boolean = parseJSONParam(process.env.EXIT_ON_HEALTH_FAILURE, false);
export const MAX_CPU_PERCENT: number = parseJSONParam(process.env.MAX_CPU_PERCENT, 99);
export const MAX_MEMORY_PERCENT: number = parseJSONParam(process.env.MAX_MEMORY_PERCENT, 99);
export const METRICS_JSON_PATH: string | null = process.env.METRICS_JSON_PATH || null;

// Server Options
export const HOST: string | undefined = process.env.HOST;
export const MAX_PAYLOAD_SIZE: string = process.env.MAX_PAYLOAD_SIZE || '5mb';
export const PORT: number = parseJSONParam(process.env.PORT, 8080);
