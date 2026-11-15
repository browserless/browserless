import {
  APITags,
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessRoutes,
  CDPLaunchOptions,
  ChromiumCDP,
  ContextValue,
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
import { CDPSession, Page } from 'puppeteer-core';
import { mkdir, readdir } from 'fs/promises';
import { ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { deleteAsync } from 'del';
import functionHandler from './utils/function/handler.js';
import path from 'path';

interface JSONSchema {
  code: string;
  context?: { [key: string]: ContextValue };
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

type DownloadState = 'inProgress' | 'completed' | 'canceled';

/**
 * How long to wait, after the function returns, for Chrome to report that a
 * download has started before answering that nothing was downloaded.
 */
const downloadStartTimeoutMs = 30_000;

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
  path = [HTTPRoutes.chromiumDownload, HTTPRoutes.download];
  tags = [APITags.browserAPI];
  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
    browser: BrowserInstance,
  ): Promise<void> {
    const config = this.config();
    const downloadPath = path.join(
      await config.getDownloadsDir(),
      `.browserless.download.${id()}`,
    );

    logger.debug(`Generating a download directory at "${downloadPath}"`);
    await mkdir(downloadPath);

    let clientClosed = false;
    res.once('close', () => (clientClosed = true));

    // Chrome reports a download it gave up on (an error status, a blocked
    // or failed request) only through these events: no file is ever written.
    const downloads = new Map<string, { state: DownloadState; url: string }>();
    let downloadEvents: CDPSession | null = null;
    const watchDownloads = async (hostPage: Page) => {
      try {
        const session = await hostPage.browser().target().createCDPSession();
        session.on('Browser.downloadWillBegin', ({ guid, url }) => {
          logger.debug(`Download of "${url}" has started`);
          downloads.set(guid, { state: 'inProgress', url });
        });
        session.on('Browser.downloadProgress', ({ guid, state }) => {
          const download = downloads.get(guid);
          if (!download) return;
          download.state = state;
          if (state === 'canceled') {
            logger.debug(`Download of "${download.url}" was canceled`);
          }
        });
        await session.send('Browser.setDownloadBehavior', {
          behavior: 'allow',
          downloadPath,
          eventsEnabled: true,
        });
        downloadEvents = session;
      } catch (e) {
        logger.debug(`Download events are unavailable: "${e}"`);
      }
    };

    const handler = functionHandler(
      config,
      logger,
      { downloadPath },
      { beforeRun: watchDownloads },
    );
    const { page } = await handler(req, browser).catch((e) => {
      logger.error(`Error running download code handler: "${e}"`);
      throw e;
    });

    logger.debug(`Download function has returned, finding downloads...`);
    const functionReturnedAt = Date.now();
    async function waitForDownload(): Promise<string | null> {
      for (;;) {
        if (res.headersSent || clientClosed) {
          logger.trace(
            `Request has been answered or closed, terminating download watch.`,
          );
          return null;
        }
        const [fileName] = await readdir(downloadPath);
        if (fileName && !fileName.endsWith('.crdownload')) {
          logger.debug(`All files have finished downloading`);
          return path.join(downloadPath, fileName);
        }

        if (!fileName) {
          const started = [...downloads.values()];
          if (
            started.length &&
            started.every(({ state }) => state === 'canceled')
          ) {
            throw new NotFound(
              `Download of "${started[started.length - 1].url}" failed: the browser canceled it, which usually means the server responded with an error status.`,
            );
          }
          if (
            !started.length &&
            Date.now() - functionReturnedAt > downloadStartTimeoutMs
          ) {
            throw new NotFound(
              `No download was started within ${downloadStartTimeoutMs / 1000}s of the function returning.`,
            );
          }
        }
        await sleep(500);
      }
    }

    let filePath: string | null = null;
    try {
      filePath = await waitForDownload();
    } finally {
      logger.debug(`Closing pages.`);
      page.removeAllListeners();
      page.close().catch(() => {});
      (downloadEvents as CDPSession | null)?.detach().catch(() => {});
    }

    const rmDownload = once(
      () =>
        filePath &&
        deleteAsync(filePath, { force: true })
          .then(() => {
            logger.debug(
              `Successfully deleted downloads from disk at "${filePath}"`,
            );
          })
          .catch((err) => {
            logger.error(
              `Error cleaning up downloaded files: "${err}" at "${filePath}"`,
            );
          }),
    );

    // Settle (rather than hang) when nothing was downloaded or a timeout
    // already wrote the response — otherwise this request holds its
    // concurrency slot until the global timeout fires.
    if (res.headersSent || !filePath) {
      rmDownload();
      return;
    }
    const contentType = mimeTypes.get(path.extname(filePath));
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    return new Promise((resolve, reject) => {
      createReadStream(filePath as string)
        .on('error', () => {
          rmDownload();
          reject(
            new NotFound(
              `Couldn't locate or send downloads in "${downloadPath}"`,
            ),
          );
        })
        .on('end', () => {
          logger.debug(`Downloads successfully sent`);
          rmDownload();
          resolve();
        })
        .pipe(res);
    });
  }
}
