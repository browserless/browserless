import {
  BadRequest,
  BrowserInstance,
  ChromiumCDP,
  Config,
  ContextValue,
  HTTPRoutes,
  Logger,
  Request,
  ServerError,
  UnwrapPromise,
  contentTypes,
  convertIfBase64,
  exists,
  getFinalPathSegment,
  getTokenFromRequest,
  makeExternalURL,
  mimeTypes,
} from '@browserless.io/browserless';
import { FunctionRunner } from './client.js';
import { Page } from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

declare global {
  interface Window {
    BrowserlessFunctionRunner: typeof FunctionRunner;
  }
}

interface JSONSchema {
  code: string;
  context?: { [key: string]: ContextValue };
}

interface HandlerOptions {
  downloadPath?: string;
  protocolTimeout?: number;
}

export default (config: Config, logger: Logger, options: HandlerOptions = {}) =>
  async (
    req: Request,
    browser: BrowserInstance,
  ): Promise<{ contentType: string; page: Page; payload: unknown }> => {
    const isJson = req.headers['content-type']?.includes('json');
    const functionPath = HTTPRoutes.function.replace('?(/)', '');
    const functionAssetLocation = path.join(config.getStatic(), 'function');
    // Page navigation and the in-page WebSocket both stay on the local
    // server: the page is served entirely via setRequestInterception, so
    // there is no reason for its origin to be the external LB. Keeping the
    // origin local (http://localhost:<port>) also means the in-page WS to
    // ws://localhost:<port> is same-origin — an HTTPS external address
    // would otherwise trigger a mixed-content block.
    const functionRequestPath = makeExternalURL(
      config.getServerAddress(),
      functionPath,
    );
    const functionIndexHTML = makeExternalURL(
      config.getServerAddress(),
      functionPath,
      '/index.html',
    );

    const { code: rawCode, context: rawContext } = isJson
      ? (req.body as JSONSchema)
      : {
          code: req.body as string,
          context: {},
        };

    const context = JSON.stringify(rawContext);
    const code = convertIfBase64(rawCode);
    const privateWSEndpoint = browser.wsEndpoint();

    if (!privateWSEndpoint) {
      throw new ServerError(
        `No browser endpoint was found, is the browser running?`,
      );
    }

    const browserID = getFinalPathSegment(privateWSEndpoint)!;
    const browserWSEndpoint = makeExternalURL(
      config.getServerWebSocketAddress(),
      'function',
      'connect',
      browserID,
      '?token=' + getTokenFromRequest(req),
    );
    const functionCodeJS = `browserless-function-${browserID}.js`;
    const page = (await browser.newPage()) as UnwrapPromise<
      ReturnType<ChromiumCDP['newPage']>
    >;
    await page.setRequestInterception(true);

    /**
     * We serve static files to the function api by injecting
     * request responses. This is done because users can use
     * a proxy, which might not have access or abilities to
     * request the function index/js from this server.
     */
    page.on('request', async (request) => {
      const requestUrl = request.url();
      logger.trace(`Outbound Page Request: "${requestUrl}"`);
      if (requestUrl.startsWith(functionRequestPath)) {
        const filename = path.basename(requestUrl);
        if (filename === functionCodeJS) {
          return request.respond({
            body: code,
            contentType: contentTypes.javascript,
            status: 200,
          });
        }
        const filePath = path.join(functionAssetLocation, filename);
        if (await exists(filePath)) {
          const contentType = mimeTypes.get(path.extname(filePath));
          return request.respond({
            body: await fs.promises.readFile(filePath, 'utf-8'),
            contentType: contentType,
            status: 200,
          });
        }
        logger.warn(
          `Static asset request to "${requestUrl}" couldn't be found, 404-ing`,
        );
        return request.respond({
          body: code,
          contentType: `Couldn't locate this file "${filename}" request "${requestUrl}" in "${functionAssetLocation}"`,
          status: 404,
        });
      }
      logger.trace(
        `Request: "${requestUrl}" no responder found, continuing...`,
      );
      return request.continue();
    });

    page.on('response', (res) => {
      if (!res.ok()) {
        const status = res.status();
        const msg = `Received a ${status} response for request "${res.url()}"`;
        // Keep actionable failures at warn — server errors (5xx) and
        // blocking/rate-limit responses (403, 429: target down or
        // bot-detection). Routine sub-resource misses (favicon 404s,
        // redirects, etc.) are expected during a page load and just noise,
        // so log those at debug (the sibling page.on handlers above use trace).
        if (status >= 500 || status === 403 || status === 429) {
          logger.warn(msg);
        } else {
          logger.debug(msg);
        }
      }
    });

    page.on('console', (event) => {
      logger.trace(`${event.type()}: ${event.text()}`);
    });

    // The page only escapes this function via the success return below —
    // any throw from goto/evaluate must close it here or it leaks for the
    // life of the browser.
    try {
      await page.goto(functionIndexHTML);

      const { contentType, payload } = await page
        .evaluate(
          async (
            browserWSEndpoint,
            context,
            functionCodeJS,
            serializedOptions,
          ) => {
            const [{ default: code }] = await Promise.all([
              import('./' + functionCodeJS),
            ]);
            console.log('/function.js: imported successfully.');
            console.log(
              `/function.js: BrowserlessFunctionRunner: ${typeof window.BrowserlessFunctionRunner}`,
            );
            const helper = new window.BrowserlessFunctionRunner();
            const options = JSON.parse(serializedOptions);
            console.log('/function.js: executing puppeteer code.');

            return helper.start({
              browserWSEndpoint,
              code,
              context: JSON.parse(context || `{}`),
              options,
            });
          },
          browserWSEndpoint,
          context,
          functionCodeJS,
          JSON.stringify(options),
        )
        .catch((e) => {
          logger.error(`Error running code: ${e}`);
          throw new BadRequest(e.message);
        });

      return {
        contentType,
        page,
        payload,
      };
    } catch (e) {
      page.removeAllListeners();
      page.close().catch(() => {});
      throw e;
    }
  };
