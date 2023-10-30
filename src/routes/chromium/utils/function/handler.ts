import fs from 'fs';
import path from 'path';

import debug from 'debug';
import { Page } from 'puppeteer-core';

import { BrowserInstance, UnwrapPromise } from 'src/types.js';

import { CDPChromium } from '../../../../browsers/cdp-chromium.js';
import { Config } from '../../../../config.js';

import { contentTypes, Request, HTTPRoutes } from '../../../../http.js';
import { mimeTypes } from '../../../../mime-types.js';
import * as util from '../../../../utils.js';

import { FunctionRunner } from './client.js';

declare global {
  interface Window {
    BrowserlessFunctionRunner: typeof FunctionRunner;
  }
}

interface JSONSchema {
  code: string;
  context?: Record<string, string | number>;
}

interface HandlerOptions {
  downloadPath?: string;
}

export default (
    config: Config,
    debug: debug.Debugger,
    options: HandlerOptions = {},
  ) =>
  async (
    req: Request,
    browser: BrowserInstance,
  ): Promise<{ contentType: string; page: Page; payload: unknown }> => {
    const isJson = req.headers['content-type']?.includes('json');

    const functionAssetLocation = path.join(config.getStatic(), 'function');
    const functionRequestPath = util.makeExternalURL(
      config.getExternalAddress(),
      HTTPRoutes.function,
    );
    const functionIndexHTML = util.makeExternalURL(
      config.getExternalAddress(),
      HTTPRoutes.function,
      '/index.html',
    );

    const { code: rawCode, context: rawContext } = isJson
      ? (req.body as JSONSchema)
      : {
          code: req.body as string,
          context: {},
        };

    const context = JSON.stringify(rawContext);
    const code = util.convertIfBase64(rawCode);
    const browserWSEndpoint = browser.publicWSEndpoint(
      req.parsed.searchParams.get('token') ?? '',
    );

    if (!browserWSEndpoint) {
      throw new Error(`No browser endpoint was found, is the browser running?`);
    }

    const functionCodeJS = `browserless-function-${util.id()}.js`;
    const page = (await browser.newPage()) as UnwrapPromise<
      ReturnType<CDPChromium['newPage']>
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
      debug(`/function.js: Page Request: "${requestUrl}"`);
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
        const exists = await util.exists(filePath);
        if (exists) {
          const contentType = mimeTypes.get(path.extname(filePath));
          return request.respond({
            body: await fs.readFileSync(filePath).toString(),
            contentType: contentType,
            status: 200,
          });
        }
        debug(
          `Static asset request to "${requestUrl}" couldn't be found, 404-ing`,
        );
        return request.respond({
          body: code,
          contentType: `Couldn't locate this file "${filename}" request "${requestUrl}" in "${functionAssetLocation}"`,
          status: 404,
        });
      }
      return request.continue();
    });

    page.on('response', (res) => {
      debug(`/function.js: Page Response: "${res.url()}"`);
      if (res.status() !== 200) {
        debug(`Received a non-200 response for request "${res.url()}"`);
      }
    });

    page.on('console', (event) => {
      debug(`${event.type()}: ${event.text()}`);
    });

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
        debug(`Error running code: ${e}`);
        throw new util.BadRequest(e.message);
      });

    return {
      contentType,
      page,
      payload,
    };
  };
