import {
  exists,
  isWin as isWindows,
  keyLength,
  untildify,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import type { NetworkRangeSet } from './network-security.js';
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

/**
 * Chromium features Playwright disables by default, mirrored per supported
 * Playwright version (verified against playwright-core 1.57–1.61).
 *
 * `--disable-features` is a single-valued Chromium switch: when it appears more
 * than once on the command line Chrome keeps ONLY the last occurrence — the
 * values are not unioned. browserless merges these into a single trailing
 * `--disable-features` flag at launch (see browsers.playwright.ts), which is the
 * occurrence Chromium keeps, so the list must match what the launched Playwright
 * version itself disables or those features are silently re-enabled (e.g.
 * RenderDocument). See https://github.com/browserless/browserless/issues/5450
 *
 * The default is what the pinned playwright-core emits (1.61, identical for
 * 1.60); versions whose list differs are overridden below. These lists must
 * stay 1:1 with the installed Playwright versions — see the drift test in
 * browsers.playwright.spec.ts.
 */
const defaultChromiumDisabledFeatures: readonly string[] = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'Translate',
  'AutoDeElevate',
  'RenderDocument',
  'OptimizationHints',
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
];

// 1.58 and 1.59 match the default except the ms*/Edge features, which Playwright
// began disabling in 1.60.
const playwright158And159DisabledFeatures: readonly string[] = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'Translate',
  'AutoDeElevate',
  'RenderDocument',
  'OptimizationHints',
];

const chromiumDisabledFeaturesByPwVersion: Readonly<
  Record<string, readonly string[]>
> = {
  // 1.57 still disables AcceptCHFrame (crbug.com/1348106) and does not yet
  // disable BoundaryEventDispatchTracksNodeRemoval or the ms*/Edge features.
  '1.57': [
    'AcceptCHFrame',
    'AvoidUnnecessaryBeforeUnloadCheckSync',
    'DestroyProfileOnBrowserClose',
    'DialMediaRouteProvider',
    'GlobalMediaControls',
    'HttpsUpgrades',
    'LensOverlay',
    'MediaRouter',
    'PaintHolding',
    'ThirdPartyStoragePartitioning',
    'Translate',
    'AutoDeElevate',
    'RenderDocument',
    'OptimizationHints',
  ],
  '1.58': playwright158And159DisabledFeatures,
  '1.59': playwright158And159DisabledFeatures,
};

/**
 * Features browserless disables on the Playwright launch path on top of the
 * launched version's defaults. Chrome For Test (Playwright 1.57+) enforces Local
 * Network Access checks that block WebSocket connections to localhost, which
 * browserless relies on. Exposed as an overridable seam via
 * `Config#getBrowserlessChromiumDisabledFeatures` so subclasses can disable
 * additional features without forking the launcher.
 * See https://github.com/browserless/browserless/issues/5450
 */
export const browserlessChromiumDisabledFeatures: readonly string[] = [
  'LocalNetworkAccessChecks',
];

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
  protected machineStatsSource: string = (
    process.env.MACHINE_STATS_SOURCE ?? 'auto'
  )
    .trim()
    .toLowerCase();
  protected cpuSampleIntervalMs = +(
    process.env.CPU_SAMPLE_INTERVAL_MS ?? '1000'
  );
  protected cpuEmaAlpha = +(process.env.CPU_EMA_ALPHA ?? '0.3');
  protected cpuOverloadHysteresis = +(
    process.env.CPU_OVERLOAD_HYSTERESIS ?? '10'
  );
  protected maxPayloadSize = +(process.env.MAX_PAYLOAD_SIZE ?? '10485760'); // Default 10MB
  protected healthCheck = !!parseEnvVars(false, 'HEALTH');
  protected failedHealthURL = process.env.FAILED_HEALTH_URL ?? null;
  protected queueAlertURL = process.env.QUEUE_ALERT_URL ?? null;
  protected rejectAlertURL = process.env.REJECT_ALERT_URL ?? null;
  protected timeoutAlertURL = process.env.TIMEOUT_ALERT_URL ?? null;
  protected errorAlertURL = process.env.ERROR_ALERT_URL ?? null;
  protected pwVersions: { [key: string]: string } = {};
  // Sorted ascending by minor version: [minor, version string, executable path]
  protected installedBinaries: Map<string, Array<[number, string, string]>> =
    new Map();
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
   * The Chromium features to disable for a given Playwright `pwVersion`
   * (e.g. '1.57'; 'default'/undefined resolves to the current version).
   * browserless merges this into a single `--disable-features` flag at launch.
   *
   * Override to support additional Playwright versions or to adjust the list;
   * call `super.getChromiumDisabledFeatures(pwVersion)` to reuse the built-in
   * lists — e.g. delegate versions you don't add, or extend the default.
   */
  public getChromiumDisabledFeatures(pwVersion?: string): readonly string[] {
    return (
      (pwVersion && chromiumDisabledFeaturesByPwVersion[pwVersion]) ||
      defaultChromiumDisabledFeatures
    );
  }

  /**
   * Chromium features browserless disables on the Playwright launch path, on top
   * of the launched version's defaults (`getChromiumDisabledFeatures`). Override
   * — extending via `super` — to disable additional features. Unlike the version
   * list this is not validated against Playwright, so browserless- or
   * deployment-specific features can be added here.
   */
  public getBrowserlessChromiumDisabledFeatures(): readonly string[] {
    return browserlessChromiumDisabledFeatures;
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
  /**
   * Returns URL prefixes that the browser is not allowed to navigate to.
   * Used by both the CDP page-event guard and the Playwright wire-frame
   * filter to block navigations whose target URL begins with any of the
   * returned strings. Subclasses may override to add more schemes or
   * specific hostnames (e.g. RFC1918 ranges).
   *
   * Default behavior tracks `ALLOW_FILE_PROTOCOL`: when disallowed, returns
   * `['file://']`; otherwise `[]`.
   */
  public getBlockedURLPatterns(): string[] {
    return this.allowFileProtocol ? [] : ['file://'];
  }
  /**
   * Returns the private-network destinations the browser is not allowed to
   * navigate to, or `null` to disable private-network navigation blocking
   * entirely (the default). Subclasses opt in by returning a
   * {@link NetworkRangeSet} describing the loopback / link-local / cloud-
   * metadata / RFC1918 ranges to block — the matcher never changes, only the
   * range set fed to it. Scheme blocking (e.g. `file://`) stays in
   * {@link getBlockedURLPatterns}.
   */
  public getBlockedNetworkRanges(): NetworkRangeSet | null {
    return null;
  }
  public getCPULimit(): number {
    return this.maxCpu;
  }
  public getMemoryLimit(): number {
    return this.maxMemory;
  }
  public getMachineStatsSource(): 'auto' | 'host' | 'cgroup' {
    const value = this.machineStatsSource;
    if (value !== 'auto' && value !== 'host' && value !== 'cgroup') {
      throw new Error(
        `Invalid MACHINE_STATS_SOURCE value "${value}". Expected "auto", "host", or "cgroup".`,
      );
    }
    return value;
  }
  public getCpuSampleIntervalMs(): number {
    return this.cpuSampleIntervalMs;
  }
  public getCpuEmaAlpha(): number {
    return this.cpuEmaAlpha;
  }
  public getCpuOverloadHysteresis(): number {
    return this.cpuOverloadHysteresis;
  }
  public setCpuSampleIntervalMs(value: number): number {
    return (this.cpuSampleIntervalMs = value);
  }
  public setCpuEmaAlpha(value: number): number {
    return (this.cpuEmaAlpha = value);
  }
  public setCpuOverloadHysteresis(value: number): number {
    return (this.cpuOverloadHysteresis = value);
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

  public setInstalledBinaries(
    browserType: string,
    binaries: Array<[number, string, string]>,
  ) {
    this.installedBinaries.set(browserType, binaries);
  }

  public getInstalledBinaries(
    browserType: string,
  ): Array<[number, string, string]> {
    return this.installedBinaries.get(browserType) ?? [];
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

  public async resolveExecutablePath(
    browserType: 'chromium' | 'firefox' | 'webkit',
    pwVersion: string,
  ): Promise<string> {
    const versionedPw = await this.loadPwVersion(pwVersion);
    const execPath = versionedPw[browserType].executablePath();

    if (await exists(execPath)) {
      return execPath;
    }

    debug.log(
      `Binary not found for Playwright ${pwVersion} ${browserType}, searching for fallback...`,
    );

    const installed = this.getInstalledBinaries(browserType);
    const requested = parseFloat(pwVersion);

    // Prefer the closest older binary (safer: less likely to have dropped
    // protocol APIs the client relies on), then fall through to the closest newer one.
    const older = [...installed].reverse().find(([v]) => v < requested);
    const newer = installed.find(([v]) => v > requested);
    const fallback = older ?? newer;

    if (fallback) {
      const [, fallbackVersion, fallbackPath] = fallback;
      debug.log(
        `Using Playwright ${fallbackVersion} binary as fallback for ${pwVersion}: ${fallbackPath}`,
      );
      return fallbackPath;
    }

    return execPath;
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
   * Returns the fully-qualified WebSocket URL for the
   * local server address. Unlike #getExternalWebSocketAddress
   * this never includes any external load-balancer prefix
   * (e.g. an encrypted /e/<hex> segment) and is intended for
   * intra-process connections that must not be routed through
   * the public LB.
   *
   * @returns {string} The local WebSocket URL of the server
   */
  public getServerWebSocketAddress(): string {
    const httpAddress = new URL(this.getServerAddress());
    httpAddress.protocol = httpAddress.protocol.startsWith('https')
      ? 'wss:'
      : 'ws:';

    return httpAddress.href;
  }

  private selfNavigationHostsMemo?: { key: string; hosts: string[] };

  /**
   * The `host[:port]` values that resolve to this server itself. The navigation
   * guard treats these as always-allowed so the browser can load browserless's
   * own pages — e.g. the `/function` runtime page and its same-origin
   * WebSocket — even when the server binds an address the blocklist would
   * otherwise reject (commonly `0.0.0.0`/`localhost`). Port-specific, so other
   * services sharing the loopback host stay blocked.
   *
   * @returns {string[]} The server's own host[:port] values
   */
  public getSelfNavigationHosts(): string[] {
    // The navigation backstop calls this for every request and response when
    // the guard is active, so memoize the URL parsing. `host` is readonly and
    // `port` is fixed once the server binds, but key the memo on host:port so a
    // runtime #setPort still recomputes rather than serving a stale value.
    const key = `${this.host}:${this.port}`;
    if (this.selfNavigationHostsMemo?.key === key) {
      return this.selfNavigationHostsMemo.hosts;
    }
    const hosts = new Set<string>();
    for (const getAddress of [
      () => this.getServerAddress(),
      () => this.getServerWebSocketAddress(),
    ]) {
      try {
        // Resolve each address inside the try so a throwing getter (e.g. an
        // unparseable server address) is contained rather than escaping.
        hosts.add(new URL(getAddress()).host);
      } catch {
        // Skip a throwing/unparseable address rather than fail the guard.
      }
    }
    const resolved = [...hosts];
    this.selfNavigationHostsMemo = { key, hosts: resolved };
    return resolved;
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
