import {
  APITags,
  BadRequest,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  HTTPRoutes,
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
  dedent,
  noop,
  rejectRequestPattern,
  rejectResourceTypes,
  requestInterceptors,
  sleep,
  waitForEvent as waitForEvt,
  waitForFunction as waitForFn,
  writeResponse,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import { ServerResponse } from 'http';
import { Stream } from 'stream';

export interface BodySchema {
  addScriptTag?: Array<Parameters<Page['addScriptTag']>[0]>;
  addStyleTag?: Array<Parameters<Page['addStyleTag']>[0]>;
  authenticate?: Parameters<Page['authenticate']>[0];
  bestAttempt?: bestAttempt;
  blockModals?: boolean;
  cookies?: Array<Parameters<Page['setCookie']>[0]>;
  emulateMediaType?: Parameters<Page['emulateMediaType']>[0];
  gotoOptions?: Parameters<Page['goto']>[1];
  html?: Parameters<Page['setContent']>[0];
  options?: Parameters<Page['pdf']>[0];
  rejectRequestPattern?: rejectRequestPattern[];
  rejectResourceTypes?: rejectResourceTypes[];
  requestInterceptors?: Array<requestInterceptors>;
  setExtraHTTPHeaders?: Parameters<Page['setExtraHTTPHeaders']>[0];
  setJavaScriptEnabled?: boolean;
  url?: Parameters<Page['goto']>[0];
  userAgent?: Parameters<Page['setUserAgent']>[0];
  viewport?: Parameters<Page['setViewport']>[0];
  waitForEvent?: WaitForEventOptions;
  waitForFunction?: WaitForFunctionOptions;
  waitForSelector?: WaitForSelectorOptions;
  waitForTimeout?: number;
}

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

/**
 * Responds with an application/pdf content-type and a binary PDF
 */
export type ResponseSchema = string;

export default class ChromiumPDFPostRoute extends BrowserHTTPRoute {
  name = BrowserlessRoutes.ChromiumPDFPostRoute;
  accepts = [contentTypes.json];
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  contentTypes = [contentTypes.pdf];
  description = dedent(`
    A JSON-based API for getting a PDF binary from either a supplied
    "url" or "html" payload in your request. Many options exist for
    injecting cookies, request interceptors, user-agents and waiting for
    selectors, timers and more.
  `);
  method = Methods.post;
  path = [HTTPRoutes.pdf, HTTPRoutes.chromiumPdf];
  tags = [APITags.browserAPI];
  handler = async (
    req: Request,
    res: ServerResponse,
    browser: BrowserInstance,
  ): Promise<void> => {
    const contentType =
      !req.headers.accept || req.headers.accept?.includes('*')
        ? 'application/pdf'
        : req.headers.accept;

    if (!req.body) {
      writeResponse(res, 400, `Couldn't parse JSON body`);
      return;
    }

    res.setHeader('Content-Type', contentType);

    const {
      url,
      gotoOptions,
      authenticate,
      html,
      addScriptTag = [],
      addStyleTag = [],
      cookies = [],
      emulateMediaType,
      rejectRequestPattern = [],
      requestInterceptors = [],
      rejectResourceTypes = [],
      options,
      setExtraHTTPHeaders,
      setJavaScriptEnabled,
      userAgent,
      viewport,
      waitForEvent,
      waitForFunction,
      waitForSelector,
      waitForTimeout,
      bestAttempt = false,
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
          return req.abort();
        }
        const interceptor = requestInterceptors.find((r) =>
          req.url().match(r.pattern),
        );
        if (interceptor) {
          return req.respond(interceptor.response);
        }
        return req.continue();
      });
    }

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

    const gotoResponse = await gotoCall(content, gotoOptions).catch(
      bestAttemptCatch(bestAttempt),
    );

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

    const pdfBuffer = await page.pdf(options);
    const readStream = new Stream.PassThrough();
    readStream.end(pdfBuffer);

    await new Promise((r) => readStream.pipe(res).once('close', r));

    page.close().catch(noop);
  };
}
