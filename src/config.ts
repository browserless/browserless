import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

import debug from 'debug';

import { keyLength } from './constants.js';
import { exists, untildify } from './utils.js';

/**
 * configs to add:
 * EXIT_ON_HEALTH_FAILURE
 * MAX_PAYLOAD_SIZE
 */

enum oldConfig {
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  DEFAULT_USER_DATA_DIR = 'DEFAULT_USER_DATA_DIR',
  ENABLE_API_GET = 'ENABLE_API_GET',
  ENABLE_CORS = 'ENABLE_CORS',
  MAX_CONCURRENT_SESSIONS = 'MAX_CONCURRENT_SESSIONS',
  PRE_REQUEST_HEALTH_CHECK = 'PRE_REQUEST_HEALTH_CHECK',
  PROXY_URL = 'PROXY_URL',
  QUEUE_LENGTH = 'QUEUE_LENGTH',
}

enum newConfigMap {
  CONNECTION_TIMEOUT = 'TIMEOUT',
  DEFAULT_USER_DATA_DIR = 'DATA_DIR',
  ENABLE_API_GET = 'ALLOW_GET',
  ENABLE_CORS = 'CORS',
  MAX_CONCURRENT_SESSIONS = 'CONCURRENT',
  PRE_REQUEST_HEALTH_CHECK = 'HEALTH',
  PROXY_URL = 'EXTERNAL',
  QUEUE_LENGTH = 'QUEUED',
}

enum deprecatedConfig {
  CHROME_REFRESH_TIME = 'CHROME_REFRESH_TIME',
  DEFAULT_BLOCK_ADS = 'DEFAULT_BLOCK_ADS',
  DEFAULT_DUMPIO = 'DEFAULT_DUMPIO',
  DEFAULT_HEADLESS = 'DEFAULT_HEADLESS',
  DEFAULT_IGNORE_DEFAULT_ARGS = 'DEFAULT_IGNORE_DEFAULT_ARGS',
  DEFAULT_IGNORE_HTTPS_ERRORS = 'DEFAULT_IGNORE_HTTPS_ERRORS',
  DEFAULT_LAUNCH_ARGS = 'DEFAULT_LAUNCH_ARGS',
  DEFAULT_STEALTH = 'DEFAULT_STEALTH',
  DISABLED_FEATURES = 'DISABLED_FEATURES',
  ENABLE_HEAP_DUMP = 'ENABLE_HEAP_DUMP',
  FUNCTION_BUILT_INS = 'FUNCTION_BUILT_INS',
  FUNCTION_ENABLE_INCOGNITO_MODE = 'FUNCTION_ENABLE_INCOGNITO_MODE',
  FUNCTION_ENV_VARS = 'FUNCTION_ENV_VARS',
  FUNCTION_EXTERNALS = 'FUNCTION_EXTERNALS',
  KEEP_ALIVE = 'KEEP_ALIVE',
  PREBOOT_CHROME = 'PREBOOT_CHROME',
  PRINT_GET_STARTED_LINKS = 'PRINT_GET_STARTED_LINKS',
  WORKSPACE_DELETE_EXPIRED = 'WORKSPACE_DELETE_EXPIRED',
  WORKSPACE_DIR = 'WORKSPACE_DIR',
  WORKSPACE_EXPIRE_DAYS = 'WORKSPACE_EXPIRE_DAYS',
}

for (const config in deprecatedConfig) {
  if (process.env[config] !== undefined) {
    console.error(
      `Environment variable of "${config}" is deprecated and ignored. See for more details`,
    );
  }
}

for (const config in oldConfig) {
  if (process.env[config] !== undefined) {
    const newConfigName = newConfigMap[config as oldConfig];
    if (newConfigName) {
      console.error(
        `Please use variable name "${newConfigName}" in place of "${config}"`,
      );
    } else {
      console.error(
        `Environment variable of "${config}" has changed and will be removed in an upcoming release.`,
      );
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseEnvVars = (defaultVal: any, ...variableNames: string[]) => {
  return variableNames.reduce((priorReturn, variable, idx, all) => {
    if (priorReturn !== undefined) {
      return priorReturn;
    }
    const envVar = process.env[variable];
    if (envVar !== undefined) {
      return envVar !== 'false';
    }
    if (idx === all.length - 1 && priorReturn === undefined) {
      return defaultVal;
    }
  }, undefined);
};

const getDebug = () => {
  if (typeof process.env.DEBUG !== 'undefined') {
    return process.env.DEBUG;
  }

  process.env.DEBUG = 'browserless*,-**:verbose';
  debug.enable(process.env.DEBUG);
  return process.env.DEBUG;
};

export class Config extends EventEmitter {
  private readonly debug = getDebug();
  private readonly host = process.env.HOST ?? 'localhost';
  private readonly external = process.env.PROXY_URL ?? process.env.EXTERNAL;
  private readonly isWin = process.platform === 'win32';

  private port = +(process.env.PORT ?? '3000');

  private downloadsDir = process.env.DOWNLOAD_DIR
    ? untildify(process.env.DOWNLOAD_DIR)
    : path.join(tmpdir(), 'browserless-download-dirs');

  private dataDir = process.env.DATA_DIR
    ? untildify(process.env.DATA_DIR)
    : path.join(tmpdir(), 'browserless-data-dirs');

  private metricsJSONPath = process.env.METRICS_JSON_PATH
    ? untildify(process.env.METRICS_JSON_PATH)
    : path.join(tmpdir(), 'browserless-metrics.json');

  private createDataDir = !process.env.DATA_DIR;
  private createDownloadsDir = !process.env.DOWNLOAD_DIR;

  private routes = process.env.ROUTES
    ? untildify(process.env.ROUTES)
    : path.join(process.cwd(), 'build', 'routes');

  private token = process.env.TOKEN ?? randomUUID();
  private concurrent = +(
    process.env.CONCURRENT ??
    process.env.MAX_CONCURRENT_SESSIONS ??
    '10'
  );
  private queued = +(process.env.QUEUE_LENGTH ?? process.env.QUEUED ?? '10');
  private timeout = +(
    process.env.TIMEOUT ??
    process.env.CONNECTION_TIMEOUT ??
    '30000'
  );
  private static = process.env.STATIC ?? path.join(process.cwd(), 'static');
  private retries = +(process.env.RETRIES ?? '5');
  private allowFileProtocol = !!parseEnvVars(false, 'ALLOW_FILE_PROTOCOL');
  private allowGet = !!parseEnvVars(false, 'ALLOW_GET', 'ENABLE_API_GET');
  private allowCors = !!parseEnvVars(false, 'CORS', 'ENABLE_CORS');
  private corsMethods = process.env.CORS_ALLOW_METHODS ?? 'OPTIONS, POST, GET';
  private corsOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';
  private corsMaxAge = +(process.env.CORS_MAX_AGE ?? '2592000');
  private maxCpu = +(process.env.MAX_CPU_PERCENT ?? '99');
  private maxMemory = +(process.env.MAX_MEMORY_PERCENT ?? '99');
  private healthCheck = !!parseEnvVars(false, 'HEALTH');
  private failedHealthURL = process.env.FAILED_HEALTH_URL ?? null;
  private queueAlertURL = process.env.QUEUE_ALERT_URL ?? null;
  private rejectAlertURL = process.env.REJECT_ALERT_URL ?? null;
  private timeoutAlertURL = process.env.TIMEOUT_ALERT_URL ?? null;
  private errorAlertURL = process.env.ERROR_ALERT_URL ?? null;

  public getRoutes = (): string => this.routes;
  public getHost = (): string => this.host;
  public getPort = (): number => this.port;
  public getIsWin = (): boolean => this.isWin;
  public getToken = (): string => this.token;
  public getDebug = (): string => this.debug;

  /**
   * The maximum number of concurrent sessions allowed. Set
   * to "-1" or "Infinity" for no limit.
   * @returns number
   */
  public getConcurrent = (): number => this.concurrent;

  /**
   * The maximum number of queued sessions allowed. Set to
   * "-1" or "Infinity" for no limit.
   * @returns number
   */
  public getQueued = (): number => this.queued;
  public getTimeout = (): number => this.timeout;
  public getStatic = (): string => this.static;
  public getRetries = (): number => this.retries;
  public getAllowFileProtocol = (): boolean => this.allowFileProtocol;
  public getCPULimit = (): number => this.maxCpu;
  public getMemoryLimit = (): number => this.maxMemory;
  public getHealthChecksEnabled = (): boolean => this.healthCheck;
  public getFailedHealthURL = () => this.failedHealthURL;
  public getQueueAlertURL = () => this.queueAlertURL;
  public getRejectAlertURL = () => this.rejectAlertURL;
  public getTimeoutAlertURL = () => this.timeoutAlertURL;
  public getErrorAlertURL = () => this.errorAlertURL;

  /**
   * If true, allows GET style calls on our browser-based APIs, using
   * ?body=JSON format.
   */
  public getAllowGetCalls = (): boolean => this.allowGet;

  /**
   * Determines if CORS is allowed
   */
  public getAllowCORS = (): boolean => this.allowCors;

  public getDataDir = async (): Promise<string> => {
    if (this.createDataDir && !(await exists(this.dataDir))) {
      await mkdir(this.dataDir, { recursive: true }).catch((err) => {
        throw new Error(`Error in creating the data directory ${err}, exiting`);
      });
      this.createDataDir = false;
    }

    if (!(await exists(this.dataDir))) {
      throw new Error(
        `"${this.dataDir}" Directory doesn't exist, did you forget to mount or make it?`,
      );
    }

    return this.dataDir;
  };

  public getDownloadsDir = async (): Promise<string> => {
    if (this.createDownloadsDir && !(await exists(this.downloadsDir))) {
      await mkdir(this.downloadsDir, { recursive: true }).catch((err) => {
        throw new Error(
          `Error in creating the downloads directory ${err}, exiting`,
        );
      });
      this.createDownloadsDir = false;
    }

    if (!(await exists(this.downloadsDir))) {
      throw new Error(
        `"${this.downloadsDir}" Directory doesn't exist, did you forget to mount or make it?`,
      );
    }

    return this.downloadsDir;
  };

  /**
   * Repeats the TOKEN parameter up to 24 characters so we can
   * do AES encoding for saving things to disk and generating
   * secure links.
   */
  public getAESKey = () => {
    return Buffer.from(this.token.repeat(keyLength).substring(0, keyLength));
  };

  public getMetricsJSONPath = () => this.metricsJSONPath;

  public setDataDir = async (newDataDir: string): Promise<string> => {
    if (!(await exists(newDataDir))) {
      throw new Error(
        `New data-directory "${newDataDir}" doesn't exist, did you forget to mount or create it?`,
      );
    }
    this.dataDir = newDataDir;
    this.emit('data-dir', newDataDir);
    return this.dataDir;
  };

  public setRoutes = (newRoutePath: string): string => {
    this.emit('routes', newRoutePath);
    return (this.routes = newRoutePath);
  };

  public setConcurrent = (newConcurrent: number): number => {
    this.emit('concurrent', newConcurrent);
    return (this.concurrent = newConcurrent);
  };

  public setQueued = (newQueued: number): number => {
    this.emit('queued', newQueued);
    return (this.queued = newQueued);
  };

  public setToken = (newToken: string): string => {
    this.emit('token', newToken);
    return (this.token = newToken);
  };

  public setTimeout = (newTimeout: number): number => {
    this.emit('timeout', newTimeout);
    return (this.timeout = newTimeout);
  };

  public setStatic = (newStatic: string): string => {
    this.emit('static', newStatic);
    return (this.static = newStatic);
  };

  public setRetries = (newRetries: number): number => {
    this.emit('retries', newRetries);
    return (this.retries = newRetries);
  };

  public setCPULimit = (limit: number): number => {
    this.emit('cpuLimit', limit);
    return (this.maxCpu = limit);
  };

  public setMemoryLimit = (limit: number): number => {
    this.emit('memoryLimit', limit);
    return (this.maxMemory = limit);
  };

  public enableHealthChecks = (enable: boolean): boolean => {
    this.emit('healthCheck', enable);
    return (this.healthCheck = enable);
  };

  public enableGETRequests = (enable: boolean): boolean => {
    this.emit('getRequests', enable);
    return (this.allowGet = enable);
  };

  public enableCORS = (enable: boolean): boolean => {
    this.emit('cors', enable);
    return (this.allowCors = enable);
  };

  public setCORSMethods = (methods: string): string => {
    this.emit('corsMethods', methods);
    return (this.corsMethods = methods);
  };

  public setCORSOrigin = (origin: string): string => {
    this.emit('corsOrigin', origin);
    return (this.corsOrigin = origin);
  };

  public setCORSMaxAge = (maxAge: number): number => {
    this.emit('corsMaxAge', maxAge);
    return (this.corsMaxAge = maxAge);
  };
  public setFailedHealthURL = (url: string | null): string | null => {
    this.emit('failedHealthURL');
    return (this.failedHealthURL = url);
  };

  public setQueueAlertURL = (url: string | null): string | null => {
    this.emit('queueAlertURL');
    return (this.queueAlertURL = url);
  };

  public setRejectAlertURL = (url: string | null): string | null => {
    this.emit('rejectAlertURL');
    return (this.rejectAlertURL = url);
  };

  public setTimeoutAlertURL = (url: string | null): string | null => {
    this.emit('timeoutAlertURL');
    return (this.timeoutAlertURL = url);
  };

  public setErrorAlertURL = (url: string | null): string | null => {
    this.emit('errorAlertURL');
    return (this.errorAlertURL = url);
  };

  public setMetricsJSONPath = (path: string) => {
    this.emit('metricsJSONPath', path);
    return (this.metricsJSONPath = path);
  };

  public setPort = (port: number) => {
    this.emit('port', port);
    return (this.port = port);
  };

  public setAllowFileProtocol = (allow: boolean): boolean => {
    this.emit('allowFileProtocol', allow);
    return (this.allowFileProtocol = allow);
  };

  /**
   * Returns the fully-qualified server address, which
   * includes host, protocol, and port for which the
   * server is *actively* listening on. For uses behind
   * a reverse proxy or some other load-balancer, use
   * #getExternalAddress
   *
   * @returns Fully-qualified server address
   */
  public getServerAddress = (): string =>
    this.port === 443
      ? `https://${this.host}:${this.port}`
      : this.port === 80
      ? `http://${this.host}`
      : `http://${this.host}:${this.port}`;

  /**
   * Returns the the fully-qualified URL for the
   * external address that browserless might be
   * running behind *or* the server address if
   * no external URL is provided.
   *
   * @returns {string} The URL to reach the server
   */
  public getExternalAddress = (): string =>
    this.external ?? this.getServerAddress();

  /**
   * When CORS is enabled, returns relevant CORS headers
   * to requests and for the OPTIONS call. Values can be
   * overridden by specifying `CORS_ALLOW_METHODS`, `CORS_ALLOW_ORIGIN`,
   * and `CORS_MAX_AGE`
   */
  public getCORSHeaders = (): {
    'Access-Control-Allow-Methods': string;
    'Access-Control-Allow-Origin': string;
    'Access-Control-Max-Age': number;
  } => ({
    'Access-Control-Allow-Methods': this.corsMethods,
    'Access-Control-Allow-Origin': this.corsOrigin,
    'Access-Control-Max-Age': this.corsMaxAge,
  });
}
