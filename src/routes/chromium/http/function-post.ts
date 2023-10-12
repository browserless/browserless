import { ServerResponse } from 'http';
import Stream from 'stream';

import { fileTypeFromBuffer } from 'file-type';

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
  BrowserInstance,
  CDPLaunchOptions,
} from '../../../types.js';
import * as util from '../../../utils.js';
import functionHandler from '../utils/function/handler.js';

interface JSONSchema {
  code: string;
  context?: Record<string, string | number>;
}

export type BodySchema = JSONSchema | string;

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

/**
 * Responses are determined by the returned value of the function
 * itself. Binary responses (PDF's, screenshots) are returned back
 * as binary data, and primitive JavaScript values are returned back
 * by type (HTML data is "text/html", Objects are "application/json")
 */
export type ResponseSchema = unknown;

const route: BrowserHTTPRoute = {
  accepts: [contentTypes.json, contentTypes.javascript],
  auth: true,
  browser: CDPChromium,
  concurrency: true,
  contentTypes: [contentTypes.any],
  description: util.dedent(`
  A JSON or JavaScript content-type API for running puppeteer code in the browser's context.
  Browserless sets up a blank page, injects your puppeteer code, and runs it.
  You can optionally load external libraries via the "import" module that are meant for browser usage.
  Values returned from the function are checked and an appropriate content-type and response is sent back
  to your HTTP call.`),
  handler: async (
    req: Request,
    res: ServerResponse,
    browser: BrowserInstance,
  ): Promise<void> => {
    const { _config: getConfig, _debug: getDebug } = route;

    if (!getConfig || !getDebug) {
      throw new util.ServerError(`Couldn't load configuration for request`);
    }

    const debug = getDebug();
    const config = getConfig();
    const handler = functionHandler(config, debug);
    const { contentType, payload, page } = await handler(req, browser);

    debug(`Got function response of "${contentType}"`);
    page.close();
    page.removeAllListeners();

    if (contentType === 'uint8array') {
      const response = new Uint8Array(payload as Buffer);
      const type = ((await fileTypeFromBuffer(response)) || { mime: undefined })
        .mime;

      if (!type) {
        throw new util.BadRequest(
          `Couldn't determine function's response type.`,
        );
      } else {
        debug(`Sending file-type response of "${type}"`);
        const readStream = new Stream.PassThrough();
        readStream.end(response);
        res.setHeader('Content-Type', type);
        return new Promise((r) => readStream.pipe(res).once('close', r));
      }
    } else {
      util.writeResponse(
        res,
        200,
        payload as string,
        contentType as contentTypes,
      );
    }

    return;
  },
  method: Methods.post,
  path: HTTPRoutes.function,
  tags: [APITags.browserAPI],
};

export default route;
