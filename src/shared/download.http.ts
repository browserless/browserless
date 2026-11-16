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
  ServerError,
  SystemQueryParameters,
  contentTypes,
  dedent,
  id,
  mimeTypes,
  sleep,
} from '@browserless.io/browserless';
import { CDPSession, Page, Protocol } from 'puppeteer-core';
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
        'The browser disconnected or canceled the download without an observed upstream HTTP error status.',
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
  error status when observed, or 502 for a browser cancellation without an observed
  HTTP error or a browser disconnection before completion. Download setup failures return 500.
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
    const downloads = new Map<
      string,
      { state: DownloadState; url: string; status?: number }
    >();
    let downloadEvents: CDPSession | null = null;
    let page: Page | undefined;
    const watchDownloads = async (hostPage: Page) => {
      page = hostPage;
      if (clientClosed) throw new Error('Download request already closed');
      try {
        const session = await hostPage.browser().target().createCDPSession();
        downloadEvents = session;
        const responses = new Map<string, number[]>();
        const pending: Promise<unknown>[] = [];
        const attached = ({
          sessionId,
        }: Protocol.Target.AttachedToTargetEvent) => {
          const target = session.connection()!.session(sessionId)!;
          target.on('Target.attachedToTarget', attached);
          target.on(
            'Fetch.requestPaused',
            ({
              requestId,
              request,
              frameId,
              resourceType,
              networkId,
              responseStatusCode,
            }) => {
              // Browser-initiated download navigations are not tracked by
              // the renderer's Network domain. Do not attribute XHR/fetch
              // or ordinary page-navigation responses to a download.
              if (
                responseStatusCode &&
                resourceType === 'Document' &&
                !networkId
              ) {
                const key = `${frameId}\n${request.url.split('#', 1)[0]}`;
                const attempts = responses.get(key) || [];
                attempts.push(responseStatusCode);
                responses.set(key, attempts);
              }
              void target
                .send('Fetch.continueRequest', { requestId })
                .catch(() => {});
            },
          );
          const ready = Promise.all([
            target.send('Fetch.enable', {
              patterns: [{ urlPattern: '*', requestStage: 'Response' }],
            }),
            target.send('Target.setAutoAttach', {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
              filter: [{ type: 'iframe' }, { exclude: true }],
            }),
          ]).finally(() => target.send('Runtime.runIfWaitingForDebugger'));
          pending.push(ready);
          void ready.catch(() => {});
        };
        session.on('Target.attachedToTarget', attached);
        session.on('Browser.downloadWillBegin', ({ guid, url, frameId }) => {
          logger.debug(`Download of "${url}" has started`);
          downloads.set(guid, {
            state: 'inProgress',
            url,
            status: responses
              .get(`${frameId}\n${url.split('#', 1)[0]}`)
              ?.shift(),
          });
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
        // Pause each new page before its first request, including popups.
        // A separate session preserves the caller's request interception.
        await session.send('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
          filter: [{ type: 'page' }, { exclude: true }],
        });
        await Promise.all(pending);
      } catch (e) {
        logger.error(`Could not configure browser downloads: "${e}"`);
        throw new ServerError('Could not configure browser downloads.');
      }
    };

    // The route-owned session outlives the runner's inner page. Do not also
    // configure download behavior on that short-lived page's session.
    const handler = functionHandler(
      config,
      logger,
      {},
      { beforeRun: watchDownloads },
    );
    let functionReturnedAt = 0;
    let failure: { status: number; error: string } | undefined;
    async function waitForDownload(): Promise<string | null> {
      for (;;) {
        if (res.headersSent || clientClosed) {
          logger.trace(
            `Request has been answered or closed, terminating download watch.`,
          );
          return null;
        }
        const files = await readdir(downloadPath);
        const fileName = files.find((name) => !name.endsWith('.crdownload'));
        if (fileName) {
          logger.debug(`A download has finished`);
          return path.join(downloadPath, fileName);
        }

        if (!browser.isRunning()) {
          failure = {
            status: 502,
            error: 'The browser disconnected before the download completed.',
          };
          return null;
        }

        const started = [...downloads];
        if (
          started.length &&
          started.every(([, { state }]) => state === 'canceled')
        ) {
          const [, { url, status: upstream }] = started[started.length - 1];
          const status = upstream && upstream >= 400 ? upstream : 502;
          failure = {
            status,
            error: `Download of "${url}" failed: ${status === upstream ? `HTTP ${status}` : 'the browser canceled it without an observed HTTP error status'}.`,
          };
          return null;
        }
        if (
          !files.length &&
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
