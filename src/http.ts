import {
  BrowserServerOptions,
  CDPLaunchOptions,
} from '@browserless.io/browserless';

import http from 'http';

export const errorCodes = {
  400: {
    code: 400,
    description: `The request contains errors or didn't properly encode content.`,
    message: 'HTTP/1.1 400 Bad Request',
  },
  401: {
    code: 401,
    description: `The request is missing, or contains bad, authorization credentials.`,
    message: 'HTTP/1.1 401 Unauthorized',
  },
  404: {
    code: 404,
    description: `Resource couldn't be found.`,
    message: 'HTTP/1.1 404 Not Found',
  },
  408: {
    code: 408,
    description: `The request took has taken too long to process.`,
    message: 'HTTP/1.1 408 Request Timeout',
  },
  429: {
    code: 429,
    description: `Too many requests are currently being processed.`,
    message: 'HTTP/1.1 429 Too Many Requests',
  },
  500: {
    code: 500,
    description: `An internal error occurred when handling the request.`,
    message: 'HTTP/1.1 500 Internal Server Error',
  },
  503: {
    code: 503,
    description: `Service is unavailable.`,
    message: 'HTTP/1.1 503 Service Unavailable',
  },
} as const;

export const okCodes = {
  200: {
    code: 200,
    description: `The request ran successfully and returned an OK response.`,
    message: 'HTTP/1.1 200 OK',
  },
  204: {
    code: 204,
    description: `The request ran successfully, but no response was necessary.`,
    message: 'HTTP/1.1 204 No Content',
  },
} as const;

export const codes = {
  ...errorCodes,
  ...okCodes,
} as const;

export enum contentTypes {
  any = '*/*',
  html = 'text/html',
  javascript = 'application/javascript',
  jpeg = 'image/jpeg',
  json = 'application/json',
  pdf = 'application/pdf',
  png = 'image/png',
  text = 'text/plain',
  zip = 'application/zip',
}

export enum encodings {
  utf8 = 'UTF-8',
}

export enum Methods {
  delete = 'delete',
  get = 'get',
  post = 'post',
  put = 'put',
}

export enum WebsocketRoutes {
  '/' = '?(/)',
  browser = '/devtools/browser/*',
  chrome = '/chrome?(/)',
  chromePlaywright = '/chrome/playwright?(/)',
  chromium = '/chromium?(/)',
  chromiumPlaywright = '/chromium/playwright?(/)',
  edge = '/edge?(/)',
  edgePlaywright = '/edge/playwright?(/)',
  firefoxPlaywright = '/firefox/playwright?(/)',
  functionClientConnect = '/function/connect/*',
  page = '/devtools/page/*',
  playwrightChrome = '/playwright/chrome?(/)',
  playwrightChromium = '/playwright/chromium?(/)',
  playwrightFirefox = '/playwright/firefox?(/)',
  playwrightWebkit = '/playwright/webkit?(/)',
  webkitPlaywright = '/webkit/playwright?(/)',
}

export enum HTTPRoutes {
  chromeContent = '/chrome/content?(/)',
  chromeDownload = '/chrome/download?(/)',
  chromeFunction = '/chrome/function?(/)',
  chromePdf = '/chrome/pdf?(/)',
  chromePerformance = '/chrome/performance?(/)',
  chromeScrape = '/chrome/scrape?(/)',
  chromeScreenshot = '/chrome/screenshot?(/)',
  edgeContent = '/edge/content?(/)',
  edgeDownload = '/edge/download?(/)',
  edgeFunction = '/edge/function?(/)',
  edgePdf = '/edge/pdf?(/)',
  edgePerformance = '/edge/performance?(/)',
  edgeScrape = '/edge/scrape?(/)',
  edgeScreenshot = '/edge/screenshot?(/)',
  chromiumContent = '/chromium/content?(/)',
  chromiumDownload = '/chromium/download?(/)',
  chromiumFunction = '/chromium/function?(/)',
  chromiumPdf = '/chromium/pdf?(/)',
  chromiumPerformance = '/chromium/performance?(/)',
  chromiumScrape = '/chromium/scrape?(/)',
  chromiumScreenshot = '/chromium/screenshot?(/)',
  content = '/content?(/)',
  download = '/download?(/)',
  function = '/function?(/)',
  jsonList = '/json/list?(/)',
  jsonNew = '/json/new?(/)',
  jsonProtocol = '/json/protocol?(/)',
  jsonVersion = '/json/version?(/)',
  pdf = '/pdf?(/)',
  performance = '/performance?(/)',
  scrape = '/scrape?(/)',
  screenshot = '/screenshot?(/)',
}

export enum HTTPManagementRoutes {
  active = '/active?(/)',
  config = '/config?(/)',
  kill = '/kill/+([0-9a-zA-Z-_])?(/)',
  meta = '/meta?(/)',
  metrics = '/metrics?(/)',
  metricsTotal = '/metrics/total?(/)',
  pressure = '/pressure?(/)',
  sessions = '/sessions?(/)',
  static = '/',
}

export enum APITags {
  'browserAPI' = 'Browser REST APIs',
  'browserWS' = 'Browser WebSocket APIs',
  'management' = 'Management REST APIs',
}

export interface Request extends http.IncomingMessage {
  body: unknown;
  parsed: URL;
  queryParams: Record<string, unknown>;
}

export type Response = http.ServerResponse;

export interface SystemQueryParameters {
  /**
   * Whether or nor to load ad-blocking extensions for the session.
   * This currently uses uBlock-Lite and may cause certain sites
   * to not load properly.
   */
  blockAds?: boolean;

  /**
   * Launch options, which can be either an object
   * of puppeteer.launch options or playwright.launchServer
   * options, depending on the API. Must be either JSON
   * object, or a base64-encoded JSON object.
   */
  launch?: CDPLaunchOptions | BrowserServerOptions | string;

  /**
   * Override the system-level timeout for this request.
   * Accepts a value in milliseconds.
   */
  timeout?: number;

  /**
   * The authorization token
   */
  token?: string;

  /**
   * Custom session identifier
   */
  trackingId?: string;
}
