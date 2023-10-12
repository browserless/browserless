import * as http from 'http';
import * as stream from 'stream';

import {
  Page,
  ResponseForRequest,
  HTTPRequest,
  ScreenshotOptions,
} from 'puppeteer-core';

import { BrowserManager } from './browsers';
import { CDPChromium } from './browsers/cdp-chromium';
import { PlaywrightChromium } from './browsers/playwright-chromium';
import { PlaywrightFirefox } from './browsers/playwright-firefox';
import { PlaywrightWebkit } from './browsers/playwright-webkit';
import { Config } from './config';
import { FileSystem } from './file-system';
import {
  contentTypes,
  HTTPManagementRoutes,
  HTTPRoutes,
  Methods,
  WebsocketRoutes,
  Request,
  APITags,
} from './http';
import { Metrics } from './metrics';
import { Monitoring } from './monitoring';

export interface BeforeRequest {
  head?: Buffer;
  req: Request;
  res?: http.ServerResponse;
  socket?: stream.Duplex;
}

export interface AfterResponse {
  req: http.IncomingMessage;
  start: number;
  status: 'successful' | 'error' | 'timedout';
}

export interface BrowserHook {
  browser:
    | CDPChromium
    | PlaywrightChromium
    | PlaywrightFirefox
    | PlaywrightWebkit;
  meta: URL;
}

export interface PageHook {
  meta: URL;
  page: Page;
}

export interface RouteParams {
  config: Config;
  metrics: Metrics;
  schema?: unknown;
}

export type BrowserClasses =
  | typeof CDPChromium
  | typeof PlaywrightChromium
  | typeof PlaywrightFirefox
  | typeof PlaywrightWebkit;

export type BrowserInstance =
  | CDPChromium
  | PlaywrightChromium
  | PlaywrightFirefox
  | PlaywrightWebkit;

export interface BrowserJSON {
  Browser: string;
  'Protocol-Version': string;
  'User-Agent': string;
  'V8-Version': string;
  'WebKit-Version': string;
}

type defaultLaunchOptions =
  | CDPLaunchOptions
  | BrowserlessLaunch
  | ((req: Request) => CDPLaunchOptions | BrowserlessLaunch);

interface Route {
  _browserManager?: () => BrowserManager;
  _config?: () => Config;
  _debug?: () => debug.Debugger;
  _fileSystem?: () => FileSystem;
  _metrics?: () => Metrics;
  _monitor?: () => Monitoring;

  /**
   * Whether the route requires a token to access
   */
  auth: boolean;

  /**
   * The schematic of the submitted BODY (typically)
   * an object when the route is json-based.
   */
  bodySchema?: unknown;

  /**
   * Whether the route should be bound by the global
   * concurrency limit
   */
  concurrency: boolean;

  /**
   * Description of the route and what it does
   */
  description: string;

  /**
   * The HTTP path that this route handles
   */
  path: HTTPRoutes | WebsocketRoutes | HTTPManagementRoutes | string;

  /**
   * The query parameters accepted by the route, defined in
   * an object format.
   */
  querySchema?: unknown;

  /**
   * The structure of the routes response when successful
   */
  responseSchema?: unknown;

  /**
   * The tag(s) for the route to categorize it in the
   * documentation portal
   */
  tags: APITags[];
}

interface BasicHTTPRoute extends Route {
  /**
   * The allowed Content-Types that this route can read and handle.
   * If a request comes in with a Content-Type of 'application/json', then
   * this accepts would need to include ["application/json"] in order to not 404
   */
  accepts: Array<contentTypes>;

  /**
   * The Content-Types that this route will will respond with, and must match the Accepts
   * Header from a client if present. If a request comes in with an Accepts of "application/json"
   * then the contentTypes here would need to include ["application/json"] in order to not 404.
   */
  contentTypes: Array<contentTypes>;

  /**
   * The allowed methods ("GET", "POST", etc) this route can utilize and match against.
   */
  method: Methods;
}

export interface HTTPRoute extends BasicHTTPRoute {
  browser: null;

  /**
   * Handles an inbound HTTP request, and supplies the Request and Response objects from node's HTTP request event
   */
  handler: (req: Request, res: http.ServerResponse) => Promise<unknown>;
}

export interface BrowserHTTPRoute extends BasicHTTPRoute {
  browser: BrowserClasses;

  defaultLaunchOptions?: defaultLaunchOptions;

  /**
   * Handles an inbound HTTP request with a 3rd param of the predefined
   * browser used for the route -- only Chrome CDP is support currently.
   */
  handler: (
    req: Request,
    res: http.ServerResponse,
    browser: BrowserInstance,
  ) => Promise<unknown>;

  onNewPage?: undefined;
}

export interface WebSocketRoute extends Route {
  browser: null;

  /**
   * Handles an inbound Websocket request, and handles the connection
   */
  handler: (
    req: Request,
    socket: stream.Duplex,
    head: Buffer,
  ) => Promise<unknown>;
}

export interface BrowserWebsocketRoute extends Route {
  browser: BrowserClasses;

  defaultLaunchOptions?: defaultLaunchOptions;

  /**
   * Handles an inbound Websocket request, and handles the connection
   * with the prior set browser being injected.
   */
  handler(
    req: Request,
    socket: stream.Duplex,
    head: Buffer,
    browser: BrowserInstance,
  ): Promise<unknown>;

  onNewPage?: (url: URL, page: Page) => Promise<void>;
}

interface BrowserlessLaunch {
  stealth?: boolean;
}

export interface CDPLaunchOptions extends BrowserlessLaunch {
  args?: string[];
  defaultViewport?: {
    deviceScaleFactor?: number;
    hasTouch?: boolean;
    height: number;
    isLandscape?: boolean;
    isMobile?: boolean;
    width: number;
  };
  devtools?: boolean;
  dumpio?: boolean;
  headless?: boolean | 'new';
  ignoreDefaultArgs?: boolean | string[];
  ignoreHTTPSErrors?: boolean;
  slowMo?: number;
  stealth?: boolean;
  timeout?: number;
  userDataDir?: string;
  waitForInitialPage?: boolean;
}

export interface BrowserServerOptions {
  args?: string[];
  chromiumSandbox?: boolean;
  devtools?: boolean;
  downloadsPath?: string;
  headless?: boolean;
  ignoreDefaultArgs?: boolean | string[];
  proxy?: {
    bypass?: string;
    password?: string;
    server: string;
    username?: string;
  };
  timeout?: number;
  tracesDir?: string;
}

export interface BrowserlessSession {
  id: string | null;
  initialConnectURL: string;
  isTempDataDir: boolean;
  launchOptions: CDPLaunchOptions | BrowserServerOptions;
  numbConnected: number;
  resolver: (val: unknown) => void;
  routePath: string;
  startedOn: number;
  ttl: number;
  userDataDir: string | null;
}

export interface BrowserlessSessionJSON {
  browser: string;
  id: string | null;
  initialConnectURL: string;
  killURL: string | null;
  launchOptions: CDPLaunchOptions | BrowserServerOptions;
  numbConnected: number;
  routePath: string;
  startedOn: number;
  timeAliveMs: number;
  userDataDir: string | null;
}

export interface BrowserlessSessionFullJSON extends BrowserlessSessionJSON {
  pages: {
    title: string;
    url: string;
  }[];
}

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

export type WaitForFunctionOptions = {
  /**
   * The function, or statement, to be evaluated in browser context
   */
  fn: string;

  /**
   * An interval at which the pageFunction is executed, defaults to raf.
   * If polling is a number, then it is treated as an interval in milliseconds
   * at which the function would be executed. If polling is a string,
   * then it can be one of the following values: "raf" or "mutation"
   */
  polling?: string | number;

  /**
   * Maximum time to wait for in milliseconds. Defaults to 30000 (30 seconds).
   * Pass 0 to disable timeout.
   */
  timeout?: number;
};

export type WaitForSelectorOptions = {
  hidden?: boolean;
  selector: string;
  timeout?: number;
  visible?: boolean;
};

export type WaitForEventOptions = {
  event: string;
  timeout?: number;
};
export interface ScreenshotSizeOptions {
  height?: number;
  scale?: number;
  width?: number;
}

export interface ScrapeElementSelector {
  selector: string;
  timeout?: number;
}

export interface ScrapeDebugOptions {
  console?: boolean;
  cookies?: boolean;
  html?: boolean;
  network?: boolean;
  screenshot?: boolean;
}

export interface OutBoundRequest {
  headers: unknown;
  method: string;
  url: string;
}

export interface InBoundRequest {
  headers: unknown;
  status: number;
  url: string;
}

export const debugScreenshotOpts: ScreenshotOptions = {
  encoding: 'base64',
  fullPage: true,
  quality: 20,
  type: 'jpeg',
};

declare global {
  interface Window {
    browserless: BrowserlessEmbeddedAPI;
  }
}

export interface BrowserlessEmbeddedAPI {
  getRecording: () => Promise<string>;
  liveUrl: () => string;
  saveRecording: () => Promise<boolean>;
  startRecording: () => void;
}

/**
 * When bestAttempt is set to true, browserless attempt to proceed
 * when "awaited" events fail or timeout. This includes things like
 * goto, waitForSelector, and more.
 */
export type bestAttempt = boolean;

/**
 * Whether or not to allow JavaScript to run on the page.
 */
export type setJavaScriptEnabled = boolean;

/**
 * A pattern to match requests with automatic rejections.
 * Internally we do this with the following: `req.url().match(pattern)`.
 */
export type rejectRequestPattern = string;
export type rejectResourceTypes = ReturnType<HTTPRequest['resourceType']>;

/**
 * An array of patterns (using `req.url().match(r.pattern)` to match) and their
 * corresponding responses to use in order to fulfill those requests.
 */
export type requestInterceptors = {
  /**
   * An array of patterns (using `req.url().match(r.pattern)` to match) and their
   * corresponding responses to use in order to fulfill those requests.
   */
  pattern: string;
  response: Partial<ResponseForRequest>;
};

export interface IResourceLoad {
  cpu: number | null;
  memory: number | null;
}

export interface IBrowserlessPressure {
  cpu: number | null;
  date: number;
  isAvailable: boolean;
  maxConcurrent: number;
  maxQueued: number;
  memory: number | null;
  message: string;
  queued: number;
  reason: string;
  recentlyRejected: number;
  running: number;
}

export interface IBrowserlessMetricTotals {
  error: number;
  estimatedMonthlyUnits: number;
  maxConcurrent: number;
  maxTime: number;
  meanTime: number;
  minTime: number;
  minutesOfMetricsAvailable: number;
  queued: number;
  rejected: number;
  sessionTimes: number[];
  successful: number;
  timedout: number;
  totalTime: number;
  unhealthy: number;
  units: number;
}

export interface IBrowserlessStats {
  cpu: number | null;
  date: number;
  error: number;
  maxConcurrent: number;
  maxTime: number;
  meanTime: number;
  memory: number | null;
  minTime: number;
  queued: number;
  rejected: number;
  sessionTimes: number[];
  successful: number;
  timedout: number;
  totalTime: number;
  unauthorized: number;
  unhealthy: number;
  units: number;
}
