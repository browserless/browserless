import {
  IncomingMessage,
  OutgoingMessage,
  ServerResponse,
  ClientRequest,
} from 'http';

import httpProxy from 'http-proxy';
import _ from 'lodash';
import kill from 'tree-kill';

import * as chromeHelper from './chrome-helper';
import { Queue } from './queue';
import {
  IChromeDriver,
  IBrowserlessStats,
  IWebdriverStartHTTP,
  IWebdriverStartNormalized,
  IWebDriverSession,
  IWebDriverSessions,
  IDone,
  IJob,
} from './types.d';
import { getDebug } from './utils';

const debug = getDebug('webdriver');

export class WebDriver {
  private queue: Queue;
  private webDriverSessions: IWebDriverSessions;

  constructor(queue: Queue) {
    this.queue = queue;
    this.webDriverSessions = {};
  }

  // Since Webdriver commands happen over HTTP, and aren't
  // maintained, we treat with the initial session request
  // with some special circumstances and use it inside our queue
  public async start(
    req: IWebdriverStartHTTP,
    res: ServerResponse,
    params: IWebdriverStartNormalized['params'],
    currentStat: IBrowserlessStats,
  ): Promise<ServerResponse | void> {
    debug(`Inbound webdriver request`);

    if (!this.queue.hasCapacity) {
      debug(`Too many concurrent and queued requests, rejecting.`);
      currentStat.rejected++;
      return res.end();
    }

    if (await this.queue.overloaded()) {
      debug(`Server under heavy load, closing.`);
      currentStat.unhealthy++;
      res.writeHead && res.writeHead(503);
      return res.end(`Server under heavy load.`);
    }

    const earlyClose = () => {
      debug(`Request terminated prior to execution, removing from queue`);
      this.queue.remove(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        req.removeListener('close', earlyClose);
        this.launchChrome(params)
          .then((chromeDriver) => {
            const proxy: any = httpProxy.createProxyServer({
              changeOrigin: true,
              target: `http://localhost:${chromeDriver.port}`,
            });

            // Re-add the JSON body before forwarding the request
            proxy.once('proxyReq', (proxyReq: ClientRequest) => {
              const bodyData = JSON.stringify(req.body);
              proxyReq.setHeader('Content-Type', 'application/json');
              proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
              proxyReq.write(bodyData);
            });

            proxy.once('proxyRes', (proxyRes: OutgoingMessage) => {
              let body = Buffer.from('');
              proxyRes.on(
                'data',
                (data) => (body = Buffer.concat([body, data])),
              );
              proxyRes.on('end', () => {
                const responseBody = body.toString();
                const session = JSON.parse(responseBody);
                const id = session.sessionId || session.value.sessionId;
                const browser = chromeDriver.browser();

                if (!id) {
                  if (browser) {
                    debug(
                      `Error starting chromedriver, killing underlying chromium.`,
                    );
                    chromeHelper.closeBrowser(browser);
                  }
                  return done(
                    new Error(
                      `No session ID in chromedriver response: ${_.truncate(
                        responseBody,
                        { length: 500 },
                      )}`,
                    ),
                  );
                }

                debug('Session started, got body: ', responseBody);

                chromeDriver.chromeProcess.once('exit', done);

                job.id = id;

                this.webDriverSessions[id] = {
                  browser,
                  chromeDriver: chromeDriver.chromeProcess,
                  done,
                  proxy,
                  res,
                  sessionId: id,
                };

                job.onTimeout = (): ServerResponse | void => {
                  const res = this.webDriverSessions[id].res;
                  if (res && !res.headersSent) {
                    res.writeHead && res.writeHead(408);
                    return res.end(`Webdriver session timed-out`);
                  }
                };

                job.close = () => {
                  debug(
                    `Killing chromedriver and proxy ${chromeDriver.chromeProcess.pid}`,
                  );
                  const browser = chromeDriver.browser();

                  if (chromeDriver.chromeProcess.pid) {
                    kill(chromeDriver.chromeProcess.pid, 'SIGKILL');
                  }
                  chromeDriver.chromeProcess.off('close', done);
                  browser && chromeHelper.closeBrowser(browser);
                  proxy.close();
                  delete this.webDriverSessions[id];
                };
              });
            });

            proxy.web(req, res, (error: Error) => {
              debug(`Issue in webdriver: ${error.message}`);
              res.end();
              done(error);
            });
          })
          .catch((error) => {
            debug(`Failure to launch ChromeDriver`);
            done(error);
            res.writeHead && res.writeHead(500);
            res.end('ChromeDriver failed to launch.');
          });
      },
      {
        browser: null,
        close: () => undefined,
        id: '',
        req,
        start: Date.now(),
      },
    );

    req.once('close', earlyClose);
    this.queue.add(job);
  }

  public proxySession(req: IncomingMessage, res: ServerResponse) {
    debug(`Inbound existing webdriver command`);
    const session = this.getSession(req);

    if (!session) {
      res.writeHead && res.writeHead(404);
      res.end(`Couldn't access session, did it timeout?`);
      return res.end();
    }

    session.res = res;

    return session.proxy.web(req, res, (error: Error) => {
      debug(
        `Issue proxying current webdriver session, closing session: ${error.message}`,
      );

      if (!res.headersSent) {
        res.writeHead && res.writeHead(500);
        res.end('ChromeDriver failed to receive traffic');
      }

      session.done(error);
      res.end();
    });
  }

  public closeSession(req: IncomingMessage, res: ServerResponse) {
    debug(`Inbound webdriver close`);
    const session = this.getSession(req);

    if (!session) {
      res.writeHead(200);
      res.end(`Session not found, did it timeout?`);
      return res.end();
    }

    session.res = res;
    session.proxy.once('proxyRes', () => session.done());

    return session.proxy.web(req, res, (error: Error) => {
      debug(`Issue when closing webdriver session: ${error.message}`);

      if (!res.headersSent) {
        res.writeHead && res.writeHead(500);
        res.end('ChromeDriver failed to receive traffic');
      }

      session.done(error);
      res.end();
    });
  }

  // Used during shutdown
  public kill() {
    for (const sessionId in this.webDriverSessions) {
      if (sessionId) {
        const session = this.webDriverSessions[sessionId];
        if (session.chromeDriver.pid) {
          kill(session.chromeDriver.pid, 'SIGKILL');
        }
        if (session.browser) {
          debug(
            `Killing chromedriver and proxy ${session.browser._browserProcess.pid}`,
          );
          chromeHelper.closeBrowser(session.browser);
        }
        session.proxy.close();
        delete this.webDriverSessions[sessionId];
      }
    }
  }

  private getSession(req: IncomingMessage): IWebDriverSession | null {
    const urlParts = (req.url || '').split('/');
    const sessionId = urlParts[3];

    if (!sessionId) {
      debug(`Couldn't load session for URL ${req.url}`);
      return null;
    }
    const session = this.webDriverSessions[sessionId];

    if (!session) {
      debug(`No session exists for URL ${req.url}, sessionId ${sessionId}`);
      return null;
    }

    return session;
  }

  private launchChrome(
    params: IWebdriverStartNormalized['params'],
    retries = 1,
  ): Promise<IChromeDriver> {
    return chromeHelper.launchChromeDriver(params).catch((error) => {
      debug(`Issue launching ChromeDriver, error:`, error);

      if (retries) {
        debug(`Retrying launch of ChromeDriver`);
        return this.launchChrome(params, retries - 1);
      }

      debug(`Retries exhausted, throwing`);
      throw error;
    });
  }
}
