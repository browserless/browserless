import http from 'http';

import { BrowserServerOptions, CDPLaunchOptions } from './types';

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
  page = '/devtools/page/*',
  playwrightChromium = '/playwright/chromium',
  playwrightFirefox = '/playwright/firefox',
  playwrightWebkit = '/playwright/webkit',
}

export enum HTTPRoutes {
  content = '/content',
  download = '/download',
  function = '/function',
  pdf = '/pdf',
  performance = '/performance',
  scrape = '/scrape',
  screenshot = '/screenshot',
}

export enum HTTPManagementRoutes {
  config = '/config',
  metrics = '/metrics',
  metricsTotal = '/metrics/total',
  sessions = '/sessions',
  static = '/',
}

export enum APITags {
  'browserAPI' = 'Browser APIs',
  'browserWS' = 'Browser WebSockets',
  'management' = 'Management APIs',
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
   * This currently uses uBlock Origin and may cause certain sites
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
   * Whether or nor to record the session. The browser will run
   * in "head-full" mode, and recording is started and closed
   * via the embedded browserless API. Please refer to the "Recording"
   * section in the live documentation site for more details.
   */
  record?: boolean;

  /**
   * Override the system-level timeout for this request.
   * Accepts a value in milliseconds.
   */
  timeout?: number;

  /**
   * The authorization token
   */
  token: string;
}
