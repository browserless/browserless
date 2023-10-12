import { ServerResponse } from 'http';

import { Page } from 'puppeteer-core';

import { CDPChromium } from '../../../browsers/cdp-chromium.js';
import {
  contentTypes,
  Request,
  Methods,
  HTTPRoutes,
  APITags,
  SystemQueryParameters,
} from '../../../http.js';

import {
  BrowserHTTPRoute,
  WaitForFunctionOptions,
  WaitForSelectorOptions,
  WaitForEventOptions,
  CDPLaunchOptions,
  bestAttempt,
  rejectRequestPattern,
  rejectResourceTypes,
  requestInterceptors,
  BrowserInstance,
  UnwrapPromise,
} from '../../../types.js';
import * as util from '../../../utils.js';

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
  waitForTimeout?: Parameters<Page['waitForTimeout']>[0];
}

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

/**
 * Responds with an application/pdf content-type and a binary PDF
 */
export type ResponseSchema = string;

const route: BrowserHTTPRoute = {
  accepts: [contentTypes.json],
  auth: true,
  browser: CDPChromium,
  concurrency: true,
  contentTypes: [contentTypes.pdf],
  description: `A JSON-based API for getting a PDF binary from either a supplied "url" or "html" payload in your request.`,
  handler: async (
    req: Request,
    res: ServerResponse,
    browser: BrowserInstance,
  ): Promise<void> => {
    const contentType =
      !req.headers.accept || req.headers.accept?.includes('*')
        ? 'application/pdf'
        : req.headers.accept;

    if (!req.body) {
      util.writeResponse(res, 400, `Couldn't parse JSON body`);
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
      waitForFunction,
      waitForSelector,
      waitForEvent,
      bestAttempt = false,
    } = req.body as BodySchema;

    const content = url || html;

    if (!content) {
      throw new util.BadRequest(
        `One of "url" or "html" properties are required.`,
      );
    }

    const page = (await browser.newPage()) as UnwrapPromise<
      ReturnType<CDPChromium['newPage']>
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
      util.bestAttemptCatch(bestAttempt),
    );

    if (waitForFunction) {
      await util
        .waitForFunction(page, waitForFunction)
        .catch(util.bestAttemptCatch(bestAttempt));
    }

    if (waitForSelector) {
      const { selector, hidden, timeout, visible } = waitForSelector;
      await page
        .waitForSelector(selector, { hidden, timeout, visible })
        .catch(util.bestAttemptCatch(bestAttempt));
    }

    if (waitForEvent) {
      await util
        .waitForEvent(page, waitForEvent)
        .catch(util.bestAttemptCatch(bestAttempt));
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

    const pdfStream = await page.createPDFStream(options);

    await new Promise((resolve, reject) => {
      return pdfStream.pipe(res).once('finish', resolve).once('error', reject);
    });

    page.close().catch(util.noop);
  },
  method: Methods.post,
  path: HTTPRoutes.pdf,
  tags: [APITags.browserAPI],
};

export default route;
