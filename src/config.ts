import fs from 'fs';
import debug from 'debug';
import _ from 'lodash';
import os from 'os';
import untildify from 'untildify';

import { Features, isFeature } from './features';
import { Feature } from './types';


// Required, by default, to make certain API's work
const REQUIRED_INTERNALS = ['url'];
const REQUIRED_EXTERNALS = ['lighthouse', 'node-pdftk', 'sharp'];

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

const getDisabledFeatures = () => {
  const disabledFeatures: Feature[] = parseJSONParam(process.env.DISABLED_FEATURES, [])
    .map((disabledFeature: string) => {
      if (isFeature(disabledFeature)) {
        return disabledFeature as Feature;
      }
      throw new Error(`Unsupported feature '${disabledFeature}'. Supported features: [${Object.entries(Features)
        .map(([_, v]) => v).join(',')}]`);
    });
  if (!parseJSONParam(process.env.ENABLE_DEBUGGER, true) && !disabledFeatures.includes(Features.DEBUGGER)) {
    disabledFeatures.push(Features.DEBUGGER);
  }
  if (!parseJSONParam(process.env.ENABLE_DEBUG_VIEWER, true) && !disabledFeatures.includes(Features.DEBUG_VIEWER)) {
    disabledFeatures.push(Features.DEBUG_VIEWER);
  }
  return disabledFeatures;
};

const parseJSONParam = (param: string | undefined, defaultParam: boolean | string[]) => {
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

const parseNumber = (param: string | undefined, defaultParam: number): number => {
  const parsed = _.parseInt(param || '');

  if (_.isNaN(parsed)) {
    return defaultParam;
  }

  return parsed;
};

const parseSocketBehavior = (behavior: string = 'http'): 'http' | 'close' => {
  if (behavior !== 'http' && behavior !== 'close') {
    console.warn(`Unknown socket behavior of "${behavior}" passed in, using "http"`)
    return 'http';
  }

  return behavior;
}

const thirtyMinutes = 30 * 60 * 1000;
const expandedDir = untildify(process.env.WORKSPACE_DIR || '');

// Timers/Queue/Concurrency
export const CONNECTION_TIMEOUT: number = parseNumber(process.env.CONNECTION_TIMEOUT, 30000);
export const MAX_CONCURRENT_SESSIONS: number = parseNumber(process.env.MAX_CONCURRENT_SESSIONS, 10);
export const QUEUE_LENGTH: number = parseNumber(process.env.MAX_QUEUE_LENGTH, 10);
export const SINGLE_RUN: boolean = parseJSONParam(process.env.SINGLE_RUN, false);

// Pre-boot/Default Launch Options
export const CHROME_REFRESH_TIME: number = parseNumber(process.env.CHROME_REFRESH_TIME, thirtyMinutes);
export const KEEP_ALIVE: boolean = parseJSONParam(process.env.KEEP_ALIVE, false);
export const DEFAULT_BLOCK_ADS: boolean = parseJSONParam(process.env.DEFAULT_BLOCK_ADS, false);
export const DEFAULT_HEADLESS: boolean = parseJSONParam(process.env.DEFAULT_HEADLESS, true);
export const DEFAULT_LAUNCH_ARGS: string[] = parseJSONParam(process.env.DEFAULT_LAUNCH_ARGS, []);
export const DEFAULT_IGNORE_DEFAULT_ARGS: boolean = parseJSONParam(process.env.DEFAULT_IGNORE_DEFAULT_ARGS, false);
export const DEFAULT_IGNORE_HTTPS_ERRORS: boolean = parseJSONParam(process.env.DEFAULT_IGNORE_HTTPS_ERRORS, false);
export const DEFAULT_DUMPIO: boolean = parseJSONParam(process.env.DEFAULT_DUMPIO, false);
export const DEFAULT_STEALTH: boolean = parseJSONParam(process.env.DEFAULT_STEALTH, false);
export const DEFAULT_USER_DATA_DIR: string | undefined = process.env.DEFAULT_USER_DATA_DIR ?
  untildify(process.env.DEFAULT_USER_DATA_DIR) :
  undefined;
export const PREBOOT_CHROME: boolean = parseJSONParam(process.env.PREBOOT_CHROME, false);

// Security and accessibility
export const DEBUG: string | undefined = getDebug();
export const DEMO_MODE: boolean = parseJSONParam(process.env.DEMO_MODE, false);
export const DISABLED_FEATURES: Feature[] = getDisabledFeatures();
export const ENABLE_CORS: boolean = parseJSONParam(process.env.ENABLE_CORS, false);
export const ENABLE_API_GET: boolean = parseJSONParam(process.env.ENABLE_API_GET, false);
export const TOKEN: string | null = process.env.TOKEN || null;
export const ENABLE_HEAP_DUMP: boolean = parseJSONParam(process.env.ENABLE_HEAP_DUMP, false);
export const ALLOW_FILE_PROTOCOL: boolean = parseJSONParam(process.env.ALLOW_FILE_PROTOCOL, false);

// Puppeteer behavior
export const DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR = parseJSONParam(process.env.DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR, false);
export const FUNCTION_BUILT_INS: string[] = parseJSONParam(process.env.FUNCTION_BUILT_INS, REQUIRED_INTERNALS);
export const FUNCTION_ENABLE_INCOGNITO_MODE: boolean = parseJSONParam(process.env.FUNCTION_ENABLE_INCOGNITO_MODE, false);
export const FUNCTION_EXTERNALS: string[] = parseJSONParam(process.env.FUNCTION_EXTERNALS, REQUIRED_EXTERNALS);
export const WORKSPACE_DIR: string = fs.existsSync(expandedDir) ? expandedDir : os.tmpdir();
export const WORKSPACE_DELETE_EXPIRED: boolean = parseJSONParam(process.env.WORKSPACE_DELETE_EXPIRED, false);
export const WORKSPACE_EXPIRE_DAYS: number = parseNumber(process.env.WORKSPACE_EXPIRE_DAYS, 30);

// Web-hooks
export const FAILED_HEALTH_URL: string | null = process.env.FAILED_HEALTH_URL || null;
export const QUEUE_ALERT_URL: string | null = process.env.QUEUE_ALERT_URL || null;
export const REJECT_ALERT_URL: string | null = process.env.REJECT_ALERT_URL || null;
export const TIMEOUT_ALERT_URL: string | null = process.env.TIMEOUT_ALERT_URL || null;
export const ERROR_ALERT_URL: string | null = process.env.ERROR_ALERT_URL || null;
export const SESSION_CHECK_FAIL_URL: string | null = process.env.SESSION_CHECK_FAIL_URL || null;

// Health
export const PRE_REQUEST_HEALTH_CHECK: boolean = parseJSONParam(process.env.PRE_REQUEST_HEALTH_CHECK, false);
export const EXIT_ON_HEALTH_FAILURE: boolean = parseJSONParam(process.env.EXIT_ON_HEALTH_FAILURE, false);
export const MAX_CPU_PERCENT: number = parseNumber(process.env.MAX_CPU_PERCENT, 99);
export const MAX_MEMORY_PERCENT: number = parseNumber(process.env.MAX_MEMORY_PERCENT, 99);
export const METRICS_JSON_PATH: string | null = process.env.METRICS_JSON_PATH ?
  untildify(process.env.METRICS_JSON_PATH) :
  null;

// Server Options

// Host and port to bind our server to
export const HOST: string | undefined = process.env.HOST;
export const PORT: number = parseNumber(process.env.PORT, 8080);
export const SOCKET_CLOSE_METHOD = parseSocketBehavior(process.env.SOCKET_CLOSE_METHOD);

// PROXY URL is used for browserless to build appropriate URLs when it's behind a proxy
// (must be a fully-qualified URL)
export const PROXY_URL: string | undefined = process.env.PROXY_URL;
export const MAX_PAYLOAD_SIZE: string = process.env.MAX_PAYLOAD_SIZE || '5mb';
