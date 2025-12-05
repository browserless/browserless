import {
  APITags,
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  HTTPRoutes,
  Logger,
  Methods,
  Request,
  SystemQueryParameters,
  UnwrapPromise,
  WaitForEventOptions,
  WaitForFunctionOptions,
  WaitForSelectorOptions,
  bestAttempt,
  bestAttemptCatch,
  contentTypes,
  isBase64Encoded,
  noop,
  rejectRequestPattern,
  rejectResourceTypes,
  requestInterceptors,
  setJavaScriptEnabled,
  sleep,
  waitForEvent as waitForEvt,
  waitForFunction as waitForFn,
  writeResponse,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import { ServerResponse } from 'http';

export interface BodySchema {
  /**
   * An array of script tags to add to the page before extracting content.
   * Each object can contain properties like `url`, `path`, or `content`.
   */
  addScriptTag?: Array<Parameters<Page['addScriptTag']>[0]>;

  /**
   * An array of style tags to add to the page before extracting content.
   * Each object can contain properties like `url`, `path`, or `content`.
   */
  addStyleTag?: Array<Parameters<Page['addStyleTag']>[0]>;

  /**
   * Credentials for HTTP authentication. Contains `username` and `password` properties.
   */
  authenticate?: Parameters<Page['authenticate']>[0];

  /**
   * When bestAttempt is set to true, browserless will attempt to proceed
   * when "awaited" events fail or timeout. This includes things like
   * goto, waitForSelector, and more.
   */
  bestAttempt?: bestAttempt;

  /**
   * An array of cookies to set on the page before navigation.
   * Each cookie object should contain at least `name` and `value` properties.
   */
  cookies?: Array<Parameters<Page['setCookie']>[0]>;

  /**
   * Changes the CSS media type of the page. Accepts values like "screen" or "print".
   */
  emulateMediaType?: Parameters<Page['emulateMediaType']>[0];

  /**
   * Options to configure the page navigation, such as `timeout` and `waitUntil`.
   */
  gotoOptions?: Parameters<Page['goto']>[1];

  /**
   * HTML content to set as the page content instead of navigating to a URL.
   */
  html?: Parameters<Page['setContent']>[0];

  /**
   * An array of patterns to match against request URLs for automatic rejection.
   * Requests matching these patterns will be aborted.
   */
  rejectRequestPattern?: rejectRequestPattern[];

  /**
   * An array of resource types to reject during page load.
   * Common types include "image", "stylesheet", "font", "script", etc.
   */
  rejectResourceTypes?: rejectResourceTypes[];

  /**
   * An array of request interceptors that can modify or mock network requests.
   * Each interceptor has a `pattern` to match URLs and a `response` to return.
   */
  requestInterceptors?: Array<requestInterceptors>;

  /**
   * An object containing additional HTTP headers to send with every request.
   */
  setExtraHTTPHeaders?: Parameters<Page['setExtraHTTPHeaders']>[0];

  /**
   * Whether or not to allow JavaScript to run on the page.
   */
  setJavaScriptEnabled?: setJavaScriptEnabled;

  /**
   * The URL to navigate to before extracting content.
   */
  url?: Parameters<Page['goto']>[0];

  /**
   * The user agent string to use for the page.
   */
  userAgent?: Parameters<Page['setUserAgent']>[0];

  /**
   * The viewport dimensions and settings for the page.
   * Includes properties like `width`, `height`, `deviceScaleFactor`, etc.
   */
  viewport?: Parameters<Page['setViewport']>[0];

  /**
   * Options for waiting for a specific event to be fired on the page.
   */
  waitForEvent?: WaitForEventOptions;

  /**
   * Options for waiting for a JavaScript function to return a truthy value.
   */
  waitForFunction?: WaitForFunctionOptions;

  /**
   * Options for waiting for a specific CSS selector to appear on the page.
   */
  waitForSelector?: WaitForSelectorOptions;

  /**
   * The amount of time in milliseconds to wait before extracting content.
   */
  waitForTimeout?: number;
}

/**
 * An HTML payload of the website or HTML after JavaScript
 * parsing and execution.
 */
export type ResponseSchema = string;

export type QuerySchema = SystemQueryParameters & {
  /**
   * Launch options for the browser, either as a JSON object or a JSON string.
   * Includes options like `headless`, `args`, `defaultViewport`, etc.
   */
  launch?: CDPLaunchOptions | string;
};

export default class ChromiumContentPostRoute extends BrowserHTTPRoute {
  name = BrowserlessRoutes.ChromiumContentPostRoute;
  accepts = [contentTypes.json];
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  contentTypes = [contentTypes.html];
  description = `A JSON-based API. Given a "url" or "html" field, runs and returns HTML content after the page has loaded and JavaScript has parsed.`;
  method = Methods.post;
  path = [HTTPRoutes.chromiumContent, HTTPRoutes.content];
  tags = [APITags.browserAPI];
  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
    browser: BrowserInstance,
  ): Promise<void> {
    logger.info('Content API invoked with body:', req.body);
    const contentType =
      !req.headers.accept || req.headers.accept?.includes('*')
        ? contentTypes.html
        : req.headers.accept;

    if (!req.body) {
      throw new BadRequest(`Couldn't parse JSON body`);
    }

    res.setHeader('Content-Type', contentType);

    const {
      bestAttempt = false,
      url,
      gotoOptions,
      html,
      authenticate,
      addScriptTag = [],
      addStyleTag = [],
      cookies = [],
      emulateMediaType,
      rejectRequestPattern = [],
      requestInterceptors = [],
      rejectResourceTypes = [],
      setExtraHTTPHeaders,
      setJavaScriptEnabled,
      userAgent,
      viewport,
      waitForTimeout,
      waitForFunction,
      waitForSelector,
      waitForEvent,
    } = req.body as BodySchema;

    const content = url || html;

    if (!content) {
      throw new BadRequest(`One of "url" or "html" properties are required.`);
    }

    const page = (await browser.newPage()) as UnwrapPromise<
      ReturnType<ChromiumCDP['newPage']>
    >;
    const gotoCall = url ? page.goto.bind(page) : page.setContent.bind(page);

    if (emulateMediaType) {
      await page.emulateMediaType(emulateMediaType);
    }

    if (cookies.length) {
      await page.setCookie(...cookies);
    }

    if (viewport) {
      await page.setViewport(viewport);
    }

    if (userAgent) {
      await page.setUserAgent(userAgent);
    }

    if (authenticate) {
      await page.authenticate(authenticate);
    }

    if (setExtraHTTPHeaders) {
      await page.setExtraHTTPHeaders(setExtraHTTPHeaders);
    }

    if (setJavaScriptEnabled) {
      await page.setJavaScriptEnabled(setJavaScriptEnabled);
    }

    if (
      rejectRequestPattern.length ||
      requestInterceptors.length ||
      rejectResourceTypes.length
    ) {
      await page.setRequestInterception(true);

      page.on('request', (req) => {
        if (
          !!rejectRequestPattern.find((pattern) => req.url().match(pattern)) ||
          rejectResourceTypes.includes(req.resourceType())
        ) {
          logger.debug(`Aborting request ${req.method()}: ${req.url()}`);
          return req.abort();
        }
        const interceptor = requestInterceptors.find((r) =>
          req.url().match(r.pattern),
        );
        if (interceptor) {
          return req.respond({
            ...interceptor.response,
            body: interceptor.response.body
              ? isBase64Encoded(interceptor.response.body as string)
                ? Buffer.from(interceptor.response.body, 'base64')
                : interceptor.response.body
              : undefined,
          });
        }
        return req.continue();
      });
    }

    const gotoResponse = await gotoCall(content, gotoOptions).catch(
      bestAttemptCatch(bestAttempt),
    );

    if (addStyleTag.length) {
      for (const tag in addStyleTag) {
        await page.addStyleTag(addStyleTag[tag]);
      }
    }

    if (addScriptTag.length) {
      for (const tag in addScriptTag) {
        await page.addScriptTag(addScriptTag[tag]);
      }
    }

    if (waitForTimeout) {
      await sleep(waitForTimeout).catch(bestAttemptCatch(bestAttempt));
    }

    if (waitForFunction) {
      await waitForFn(page, waitForFunction).catch(
        bestAttemptCatch(bestAttempt),
      );
    }

    if (waitForSelector) {
      const { selector, hidden, timeout, visible } = waitForSelector;
      await page
        .waitForSelector(selector, { hidden, timeout, visible })
        .catch(bestAttemptCatch(bestAttempt));
    }

    if (waitForEvent) {
      await waitForEvt(page, waitForEvent).catch(bestAttemptCatch(bestAttempt));
    }

    const headers = {
      'X-Response-Code': gotoResponse?.status(),
      'X-Response-IP': gotoResponse?.remoteAddress().ip,
      'X-Response-Port': gotoResponse?.remoteAddress().port,
      'X-Response-Status': gotoResponse?.statusText(),
      'X-Response-URL': gotoResponse?.url().substring(0, 1000),
    };

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        res.setHeader(key, value);
      }
    }

    const markup = await page.content();

    page.close().catch(noop);

    logger.info('Content API request completed');

    return writeResponse(res, 200, markup, contentTypes.html);
  }
}
