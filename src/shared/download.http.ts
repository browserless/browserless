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
  sleep,
} from '@browserless.io/browserless';
import { CDPSession, Page } from 'puppeteer-core';
import { mkdir, readdir } from 'fs/promises';
import { ServerResponse } from 'http';
import { createReadStream } from 'fs';
import { deleteAsync } from 'del';
import functionHandler from './utils/function/handler.js';
import path from 'path';
import { pipeline } from 'stream/promises';

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
  errorCodes = {
    502: {
      code: 502,
      description:
        'The browser canceled the download without an upstream HTTP error status.',
      message: 'HTTP/1.1 502 Bad Gateway',
    },
  };
  description = dedent(`
  A JSON or JavaScript content-type API for returning files Chrome has downloaded during
  the execution of puppeteer code, which is ran inside context of the browser.
  Browserless sets up a blank page, a fresh download directory, injects your puppeteer code, and then executes it.
  You can load external libraries via the "import" syntax, and import ESM-style modules
  that are written for execution inside of the browser. Once your script is finished, any
  downloaded files from Chromium are returned back with the appropriate content-type header.
  Failed downloads return a JSON object with an "error" message and the upstream HTTP
  error status when available, or 502 for a browser cancellation without an HTTP error.
  If no download starts within 30 seconds after the function returns, the response is 404.
  The configured request TIMEOUT (or timeout query parameter) may return 408 sooner.
  Cleanup is awaited; if cancellation or page closure fails, the browser is stopped
  before its download directory is removed, even when keepalive was requested.
  Disconnects and timeouts during running user code also stop the browser.`);
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

    let clientClosed = res.destroyed;
    const responseClosed = new Promise<null>((resolve) => {
      if (clientClosed) resolve(null);
      res.once('close', () => {
        clientClosed = true;
        resolve(null);
      });
    });

    // Chrome reports failed downloads through these events, even when it
    // never writes a file or leaves an unfinished .crdownload behind.
    const downloads = new Map<string, { state: DownloadState; url: string }>();
    let downloadEvents: CDPSession | null = null;
    let page: Page | undefined;
    const watchDownloads = async (hostPage: Page) => {
      page = hostPage;
      if (clientClosed) throw new Error('Download request already closed');
      try {
        const session = await hostPage.browser().target().createCDPSession();
        downloadEvents = session;
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
    let functionReturnedAt = 0;
    let responses: Array<{ guid: string; status?: number }> = [];
    let failure: { status: number; error: string } | undefined;
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

        const started = [...downloads];
        if (
          started.length &&
          started.every(([, { state }]) => state === 'canceled')
        ) {
          const [guid, { url }] = started[started.length - 1];
          const upstream = responses.find((response) => response.guid === guid);
          const status =
            upstream?.status && upstream.status >= 400 ? upstream.status : 502;
          failure = {
            status,
            error: `Download of "${url}" failed: ${status === upstream?.status ? `HTTP ${status}` : 'the browser canceled it without an HTTP error status'}.`,
          };
          return null;
        }
        if (
          !fileName &&
          !started.length &&
          Date.now() - functionReturnedAt > downloadStartTimeoutMs
        ) {
          throw new NotFound(
            `No download was started within ${downloadStartTimeoutMs / 1000}s of the function returning.`,
          );
        }
        await sleep(500);
      }
    }

    let functionSettled = false;
    try {
      const execution = handler(req, browser).finally(() => {
        functionSettled = true;
      });
      const result = await Promise.race([execution, responseClosed]);
      if (!result) return;
      // The download runner returns HTTP metadata rather than the user's
      // unused function result. Ordinary /function callers are unchanged.
      responses = result.payload as typeof responses;
      functionReturnedAt = Date.now();
      const filePath = await waitForDownload();
      if (res.headersSent || clientClosed) return;
      if (failure) {
        res.writeHead(failure.status, {
          'Content-Type': 'application/json; charset=UTF-8',
        });
        res.end(JSON.stringify({ error: failure.error }));
        return;
      }
      if (!filePath) return;
      const contentType = mimeTypes.get(path.extname(filePath));
      if (contentType) res.setHeader('Content-Type', contentType);
      await pipeline(createReadStream(filePath), res);
    } finally {
      const session = downloadEvents as CDPSession | null;
      // Closing the host page alone cannot stop user code in its inner page.
      let shutdownRequired = !functionSettled;
      for (const [guid, { state }] of downloads) {
        if (state !== 'inProgress') continue;
        try {
          await session?.send('Browser.cancelDownload', { guid });
        } catch {
          shutdownRequired = true;
        }
      }
      try {
        page?.removeAllListeners();
        await page?.close();
      } catch {
        shutdownRequired = true;
      }
      if (shutdownRequired) {
        // A retained browser must not keep writing into a directory we delete.
        // Browser.close suppresses CDP close errors, so confirm process exit too.
        const child = browser.process();
        const exited =
          child && child.exitCode === null && child.signalCode === null
            ? new Promise<void>((resolve) =>
                child.once('exit', () => resolve()),
              )
            : Promise.resolve();
        try {
          await browser.close();
        } finally {
          if (child && child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL');
          await exited;
        }
      }
      await session?.detach().catch(() => {});
      await deleteAsync(downloadPath, { force: true }).catch((error) => {
        logger.error(
          `Error cleaning up downloads at "${downloadPath}": ${error}`,
        );
      });
    }
  }
}
