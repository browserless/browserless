import {
  APITags,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  HTTPRoutes,
  Logger,
  Methods,
  NotFound,
  Request,
  SystemQueryParameters,
  contentTypes,
  dedent,
  id,
  mimeTypes,
  once,
  sleep,
} from '@browserless.io/browserless';
import { mkdir, readdir } from 'fs/promises';
import { ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { deleteAsync } from 'del';
import functionHandler from './utils/function/handler.js';
import path from 'path';

interface JSONSchema {
  code: string;
  context?: Record<string, string | number>;
}

export type BodySchema = JSONSchema | string;

export interface QuerySchema extends SystemQueryParameters {
  launch?: CDPLaunchOptions | string;
}

/**
 * Responses are determined by the returned value of the downloads
 * themselves, so there isn't a static response type for this API.
 */
export type ResponseSchema = unknown;

export default class ChromiumDownloadPostRoute extends BrowserHTTPRoute {
  name = BrowserlessRoutes.ChromiumDownloadPostRoute;
  accepts = [contentTypes.json, contentTypes.javascript];
  auth = true;
  browser = ChromiumCDP;
  concurrency = true;
  contentTypes = [contentTypes.any];
  description = dedent(`
  A JSON or JavaScript content-type API for returning files Chrome has downloaded during
  the execution of puppeteer code, which is ran inside context of the browser.
  Browserless sets up a blank page, a fresh download directory, injects your puppeteer code, and then executes it.
  You can load external libraries via the "import" syntax, and import ESM-style modules
  that are written for execution inside of the browser. Once your script is finished, any
  downloaded files from Chromium are returned back with the appropriate content-type header.`);
  method = Methods.post;
  path = [HTTPRoutes.download, HTTPRoutes.chromiumDownload];
  tags = [APITags.browserAPI];
  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
    browser: BrowserInstance,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const config = this.config();
      const downloadPath = path.join(
        await config.getDownloadsDir(),
        `.browserless.download.${id()}`,
      );

      logger.info(`Generating a download directory at "${downloadPath}"`);
      await mkdir(downloadPath);
      const handler = functionHandler(config, logger, { downloadPath });
      const response = await handler(req, browser).catch((e) => {
        logger.error(`Error running download code handler: "${e}"`);
        reject(e);
        return null;
      });

      if (!response) {
        return;
      }

      const { page } = response;
      logger.info(`Download function has returned, finding downloads...`);
      async function checkIfDownloadComplete(): Promise<string | null> {
        if (res.headersSent) {
          logger.trace(
            `Request headers have been sent, terminating download watch.`,
          );
          return null;
        }
        const [fileName] = await readdir(downloadPath);
        if (!fileName || fileName.endsWith('.crdownload')) {
          await sleep(500);
          return checkIfDownloadComplete();
        }

        logger.info(`All files have finished downloading`);

        return path.join(downloadPath, fileName);
      }

      const filePath = await checkIfDownloadComplete();
      logger.info(`Closing pages.`);
      page.close();
      page.removeAllListeners();

      const rmDownload = once(
        () =>
          filePath &&
          deleteAsync(filePath, { force: true })
            .then(() => {
              logger.info(
                `Successfully deleted downloads from disk at "${filePath}"`,
              );
            })
            .catch((err) => {
              logger.error(
                `Error cleaning up downloaded files: "${err}" at "${filePath}"`,
              );
            }),
      );

      if (res.headersSent || !filePath) {
        rmDownload();
        return;
      }
      const contentType = mimeTypes.get(path.extname(filePath));
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }

      return createReadStream(filePath)
        .on('error', (error) => {
          if (error) {
            rmDownload();
            return reject(
              new NotFound(
                `Couldn't locate or send downloads in "${downloadPath}"`,
              ),
            );
          }
        })
        .on('end', () => {
          logger.info(`Downloads successfully sent`);
          rmDownload();
          return resolve();
        })
        .pipe(res);
    });
  }
}
