import {
  exists,
  isWin as isWindows,
  keyLength,
  untildify,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import debug from 'debug';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import path from 'path';
import playwright from 'playwright-core';
import { tmpdir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * configs to add:
 * EXIT_ON_HEALTH_FAILURE
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
  protected readonly debug = getDebug();
  protected readonly host = process.env.HOST ?? 'localhost';
  protected readonly isWin = isWindows;
  protected external = process.env.PROXY_URL ?? process.env.EXTERNAL;

  protected port = +(process.env.PORT ?? '3000');

  protected downloadsDir = process.env.DOWNLOAD_DIR
    ? untildify(process.env.DOWNLOAD_DIR)
    : path.join(tmpdir(), 'browserless-download-dirs');

  protected dataDir = process.env.DATA_DIR
    ? untildify(process.env.DATA_DIR)
    : path.join(tmpdir(), 'browserless-data-dirs');

  protected metricsJSONPath = process.env.METRICS_JSON_PATH
    ? untildify(process.env.METRICS_JSON_PATH)
    : path.join(tmpdir(), 'browserless-metrics.json');

  protected createDataDir = !process.env.DATA_DIR;
  protected createDownloadsDir = !process.env.DOWNLOAD_DIR;

  protected routes = process.env.ROUTES
    ? untildify(process.env.ROUTES)
    : path.join(__dirname, '..', 'build', 'routes');

  protected token = process.env.TOKEN || null;
  protected concurrent = +(
    process.env.CONCURRENT ??
    process.env.MAX_CONCURRENT_SESSIONS ??
    '10'
  );
  protected queued = +(process.env.QUEUE_LENGTH ?? process.env.QUEUED ?? '10');
  protected timeout = +(
    process.env.TIMEOUT ??
    process.env.CONNECTION_TIMEOUT ??
    '30000'
  );
  protected static = process.env.STATIC ?? path.join(__dirname, '..', 'static');
  protected debuggerDir = path.join(this.static, 'debugger');
  protected retries = +(process.env.RETRIES ?? '5');
  protected allowFileProtocol = !!parseEnvVars(false, 'ALLOW_FILE_PROTOCOL');
  protected allowGet = !!parseEnvVars(false, 'ALLOW_GET', 'ENABLE_API_GET');
  protected allowCors = !!parseEnvVars(false, 'CORS', 'ENABLE_CORS');
  protected corsMethods =
    process.env.CORS_ALLOW_METHODS ?? 'OPTIONS, POST, GET';

  // A domain or glob pattern to match against the Origin header
  protected corsOrigin = process.env.CORS_ALLOW_ORIGIN ?? '*';

  // A comma-separated list of headers to allow in the Access-Control-Allow-Headers header
  protected corsHeaders = process.env.CORS_ALLOW_HEADERS ?? '*';

  // Whether to allow credentials in the Access-Control-Allow-Credentials header
  protected corsCredentials = process.env.CORS_ALLOW_CREDENTIALS ?? 'true';

  // A comma-separated list of headers to expose in the Access-Control-Expose-Headers header
  protected corsExposeHeaders = process.env.CORS_EXPOSE_HEADERS ?? '*';
  protected corsMaxAge = +(process.env.CORS_MAX_AGE ?? '2592000');
  protected maxCpu = +(process.env.MAX_CPU_PERCENT ?? '99');
  protected maxMemory = +(process.env.MAX_MEMORY_PERCENT ?? '99');
  protected maxPayloadSize = +(process.env.MAX_PAYLOAD_SIZE ?? '10485760'); // Default 10MB
  protected healthCheck = !!parseEnvVars(false, 'HEALTH');
  protected failedHealthURL = process.env.FAILED_HEALTH_URL ?? null;
  protected queueAlertURL = process.env.QUEUE_ALERT_URL ?? null;
  protected rejectAlertURL = process.env.REJECT_ALERT_URL ?? null;
  protected timeoutAlertURL = process.env.TIMEOUT_ALERT_URL ?? null;
  protected errorAlertURL = process.env.ERROR_ALERT_URL ?? null;
  protected pwVersions: { [key: string]: string } = {};
  protected enableDebugger = !!parseEnvVars(true, 'ENABLE_DEBUGGER');

  public getRoutes(): string {
    return this.routes;
  }

  public getHost(): string {
    return this.host;
  }

  public getPort(): number {
    return this.port;
  }

  public getIsWin(): boolean {
    return this.isWin;
  }

  public getToken(): string | null {
    return this.token;
  }

  public getDebug(): string {
    return this.debug;
  }

  public getPwVersions() {
    return this.pwVersions;
  }

  /**
   * The maximum number of concurrent sessions allowed. Set
   * to "-1" or "Infinity" for no limit.
   * @returns number
   */
  public getConcurrent(): number {
    return this.concurrent;
  }

  /**
   * The maximum number of queued sessions allowed. Set to
   * "-1" or "Infinity" for no limit.
   * @returns number
   */
  public getQueued(): number {
    return this.queued;
  }
  public getTimeout(): number {
    return this.timeout;
  }
  public getStatic(): string {
    return this.static;
  }
  public getDebuggerDir(): string {
    return this.debuggerDir;
  }
  public getRetries(): number {
    return this.retries;
  }
  public getAllowFileProtocol(): boolean {
    return this.allowFileProtocol;
  }
  public getCPULimit(): number {
    return this.maxCpu;
  }
  public getMemoryLimit(): number {
    return this.maxMemory;
  }
  public getMaxPayloadSize(): number {
    return this.maxPayloadSize;
  }
  public getHealthChecksEnabled(): boolean {
    return this.healthCheck;
  }
  public getFailedHealthURL() {
    return this.failedHealthURL;
  }
  public getQueueAlertURL() {
    return this.queueAlertURL;
  }
  public getRejectAlertURL() {
    return this.rejectAlertURL;
  }
  public getTimeoutAlertURL() {
    return this.timeoutAlertURL;
  }
  public getErrorAlertURL() {
    return this.errorAlertURL;
  }

  public async hasDebugger(): Promise<boolean> {
    return this.enableDebugger && (await exists(this.debuggerDir));
  }

  /**
   * If true, allows GET style calls on our browser-based APIs, using
   * ?body=JSON format.
   */
  public getAllowGetCalls(): boolean {
    return this.allowGet;
  }

  /**
   * Determines if CORS is allowed
   */
  public getAllowCORS(): boolean {
    return this.allowCors;
  }

  public async getDataDir(): Promise<string> {
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
  }

  public async getDownloadsDir(): Promise<string> {
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
  }

  /**
   * Repeats the TOKEN parameter up to 24 characters so we can
   * do AES encoding for saving things to disk and generating
   * secure links.
   */
  public getAESKey() {
    const aesToken = this.token || 'browserless';
    return Buffer.from(aesToken.repeat(keyLength).substring(0, keyLength));
  }

  public getMetricsJSONPath() {
    return this.metricsJSONPath;
  }

  public setPwVersions(versions: { [key: string]: string }) {
    return (this.pwVersions = versions);
  }

  public async loadPwVersion(version: string): Promise<typeof playwright> {
    const versions = this.getPwVersions();

    try {
      return await import(versions[version] || versions['default']);
    } catch (err) {
      debug.log('Error importing Playwright. Using default version', err);
      return playwright;
    }
  }

  public async setDataDir(newDataDir: string): Promise<string> {
    if (!(await exists(newDataDir))) {
      throw new Error(
        `New data-directory "${newDataDir}" doesn't exist, did you forget to mount or create it?`,
      );
    }
    this.dataDir = newDataDir;
    this.emit('data-dir', newDataDir);
    return this.dataDir;
  }

  public setRoutes(newRoutePath: string): string {
    this.emit('routes', newRoutePath);
    return (this.routes = newRoutePath);
  }

  public setConcurrent(newConcurrent: number): number {
    this.emit('concurrent', newConcurrent);
    return (this.concurrent = newConcurrent);
  }

  public setQueued(newQueued: number): number {
    this.emit('queued', newQueued);
    return (this.queued = newQueued);
  }

  public setToken(newToken: string | null): string | null {
    this.emit('token', newToken);
    return (this.token = newToken);
  }

  public setTimeout(newTimeout: number): number {
    this.emit('timeout', newTimeout);
    return (this.timeout = newTimeout);
  }

  public setStatic(newStatic: string): string {
    this.emit('static', newStatic);
    return (this.static = newStatic);
  }

  public setRetries(newRetries: number): number {
    this.emit('retries', newRetries);
    return (this.retries = newRetries);
  }

  public setCPULimit(limit: number): number {
    this.emit('cpuLimit', limit);
    return (this.maxCpu = limit);
  }

  public setMemoryLimit(limit: number): number {
    this.emit('memoryLimit', limit);
    return (this.maxMemory = limit);
  }

  public setMaxPayloadSize(limit: number): number {
    this.emit('maxPayloadSize', limit);
    return (this.maxPayloadSize = limit);
  }

  public enableHealthChecks(enable: boolean): boolean {
    this.emit('healthCheck', enable);
    return (this.healthCheck = enable);
  }

  public enableGETRequests(enable: boolean): boolean {
    this.emit('getRequests', enable);
    return (this.allowGet = enable);
  }

  public enableCORS(enable: boolean): boolean {
    this.emit('cors', enable);
    return (this.allowCors = enable);
  }

  public setCORSMethods(methods: string): string {
    this.emit('corsMethods', methods);
    return (this.corsMethods = methods);
  }

  public setCORSOrigin(origin: string): string {
    this.emit('corsOrigin', origin);
    return (this.corsOrigin = origin);
  }

  public setCORSMaxAge(maxAge: number): number {
    this.emit('corsMaxAge', maxAge);
    return (this.corsMaxAge = maxAge);
  }
  public setFailedHealthURL(url: string | null): string | null {
    this.emit('failedHealthURL');
    return (this.failedHealthURL = url);
  }

  public setQueueAlertURL(url: string | null): string | null {
    this.emit('queueAlertURL');
    return (this.queueAlertURL = url);
  }

  public setRejectAlertURL(url: string | null): string | null {
    this.emit('rejectAlertURL');
    return (this.rejectAlertURL = url);
  }

  public setTimeoutAlertURL(url: string | null): string | null {
    this.emit('timeoutAlertURL');
    return (this.timeoutAlertURL = url);
  }

  public setErrorAlertURL(url: string | null): string | null {
    this.emit('errorAlertURL');
    return (this.errorAlertURL = url);
  }

  public setMetricsJSONPath(path: string) {
    this.emit('metricsJSONPath', path);
    return (this.metricsJSONPath = path);
  }

  public setPort(port: number) {
    this.emit('port', port);
    return (this.port = port);
  }

  public setAllowFileProtocol(allow: boolean): boolean {
    this.emit('allowFileProtocol', allow);
    return (this.allowFileProtocol = allow);
  }

  /**
   * Returns the fully-qualified server address, which
   * includes host, protocol, and port for which the
   * server is *actively* listening on. For uses behind
   * a reverse proxy or some other load-balancer, use
   * #getExternalAddress
   *
   * @returns Fully-qualified server address
   */
  public getServerAddress(): string {
    const host = this.host === '::' ? 'localhost' : this.host;

    return this.port === 443
      ? `https://${host}:${this.port}`
      : this.port === 80
        ? `http://${host}`
        : `http://${host}:${this.port}`;
  }

  /**
   * Returns the fully-qualified URL for the
   * external address that browserless might be
   * running behind *or* the server address if
   * no external URL is provided.
   *
   * @returns {string} The URL to reach the server
   */
  public getExternalAddress(): string {
    return this.external ?? this.getServerAddress();
  }

  /**
   * Set the external URL, which Browserless uses for encoding
   * URLs over the HOST:PORT that it's bound to.
   *
   * @param address The fully-qualified URL, eg https://www.one.one.one.one.com/
   * @returns {string} The address
   */
  public setExternalAddress(address: string) {
    return (this.external = address);
  }

  /**
   * Returns the fully-qualified WebSocket URL for the
   * external address that browserless might be
   * running behind *or* the server address if
   * no external URL is provided.
   *
   * @returns {string} The URL to reach the server
   */
  public getExternalWebSocketAddress(): string {
    const httpAddress = new URL(this.external ?? this.getServerAddress());
    httpAddress.protocol = httpAddress.protocol.startsWith('https')
      ? 'wss:'
      : 'ws:';

    return httpAddress.href;
  }

  /**
   * When CORS is enabled, returns relevant CORS headers
   * to requests and for the OPTIONS call. Values can be
   * overridden by specifying `CORS_ALLOW_METHODS`, `CORS_ALLOW_ORIGIN`,
   * and `CORS_MAX_AGE`
   */
  public getCORSHeaders(): {
    'Access-Control-Allow-Credentials': string;
    'Access-Control-Allow-Headers': string;
    'Access-Control-Allow-Methods': string;
    'Access-Control-Allow-Origin': string;
    'Access-Control-Expose-Headers': string;
    'Access-Control-Max-Age': number;
  } {
    return {
      'Access-Control-Allow-Credentials': this.corsCredentials,
      'Access-Control-Allow-Headers': this.corsHeaders,
      'Access-Control-Allow-Methods': this.corsMethods,
      'Access-Control-Allow-Origin': this.corsOrigin,
      'Access-Control-Expose-Headers': this.corsExposeHeaders,
      'Access-Control-Max-Age': this.corsMaxAge,
    };
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
