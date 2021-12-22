import net from 'net';

import _ from 'lodash';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless';
import * as chromeHelper from './chrome-helper';
import { PLAYWRIGHT_ROUTE } from './constants';
import { EventArray } from './event-array';
import { Queue } from './queue';
import {
  IChromeServiceConfiguration,
  ILaunchOptions,
  IBrowser,
  IRunHTTP,
  IDone,
  IJob,
  IHTTPRequest,
} from './types.d';
import * as utils from './utils';

const sysdebug = utils.getDebug('system');
const jobdebug = utils.getDebug('job');
const jobdetaildebug = utils.getDebug('jobdetail');

export class PuppeteerProvider {
  private readonly server: BrowserlessServer;
  private config: IChromeServiceConfiguration;
  private chromeSwarm: EventArray;
  private queue: Queue;

  constructor(
    config: IChromeServiceConfiguration,
    server: BrowserlessServer,
    queue: Queue,
  ) {
    this.config = config;
    this.server = server;
    this.queue = queue;

    this.chromeSwarm = new EventArray();
  }

  get keepChromeInstance() {
    return (
      this.config.keepAlive &&
      this.config.prebootChrome &&
      this.chromeSwarm.length < this.queue.concurrencySize
    );
  }

  public async start() {
    if (this.config.prebootChrome) {
      sysdebug(
        `Starting chrome swarm: ${this.config.maxConcurrentSessions} chrome instances starting`,
      );

      if (this.config.maxConcurrentSessions > 10) {
        process.setMaxListeners(this.config.maxConcurrentSessions + 3);
      }

      const launching = Array.from(
        { length: this.config.maxConcurrentSessions },
        () => {
          const chrome = this.launchChrome(
            chromeHelper.defaultLaunchArgs,
            true,
          );
          this.chromeSwarm.push(chrome);
          return chrome;
        },
      );

      return Promise.all(launching);
    }

    return Promise.resolve();
  }

  public proxyWebRequestToPort({
    req,
    res,
    port,
  }: {
    req: any;
    res: any;
    port: string;
  }) {
    const target = `http://127.0.0.1:${port}`;

    this.server.proxy.web(req, res, { target }, (err) => {
      sysdebug('Error proxying static debugger asset request', err.message);
    });
  }

  public proxyWsRequestToPort({
    req,
    socket,
    head,
    port,
  }: {
    req: any;
    socket: any;
    head: any;
    port: string;
  }) {
    const target = `ws://127.0.0.1:${port}`;
    // Strip tokens/query-params since they break chrome
    req.url = req.parsed.pathname || '';
    this.server.proxy.ws(req, socket, head, { target });
  }

  public async runHTTP({
    code,
    context,
    req,
    res,
    before,
    after,
    detached = false,
    headless,
    flags,
    ignoreDefaultArgs = false,
    builtin = this.config.functionBuiltIns,
    external = this.config.functionExternals,
    envVars = this.config.functionEnvVars,
  }: IRunHTTP) {
    const jobId = utils.id();
    const trackingId = req.query.trackingId;

    jobdebug(
      `${jobId}: ${req.url}: Inbound HTTP request. Context: ${JSON.stringify(
        context,
      )}`,
    );

    if (!this.queue.hasCapacity) {
      jobdebug(
        `${jobId}: Too many concurrent and queued requests, rejecting with 429.`,
      );
      return this.server.rejectReq({
        req,
        res,
        code: 429,
        message: `Too Many Requests`,
        metricType: 'rejected',
        hook: this.server.capacityFullHook,
      });
    }

    if (await this.queue.overloaded()) {
      jobdebug(`${jobId}: Server under heavy load, rejecting with 503.`);
      return this.server.rejectReq({
        req,
        res,
        code: 503,
        message: `Server under load`,
        metricType: 'unhealthy',
        hook: this.server.sessionCheckFailHook,
      });
    }
    const vm = new NodeVM({
      require: {
        builtin,
        external,
        root: './node_modules',
      },
      env: _.pick(process.env, envVars),
    });

    const handler: (args: any) => Promise<any> = vm.run(
      code,
      `browserless-function-${jobId}.js`,
    );
    const earlyClose = () => {
      if (detached) {
        return;
      }
      jobdebug(
        `${job.id}: Function terminated prior to execution removing from queue`,
      );
      this.removeJob(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        const doneOnce = _.once((err?: Error) => {
          if (job.browser) {
            job.browser.removeListener('disconnected', doneOnce);
          }
          done(err);
        });
        const debug = (message: string) => jobdebug(`${job.id}: ${message}`);
        debug(`Getting browser.`);

        const urlOpts = chromeHelper.convertUrlParamsToLaunchOpts(req);

        const launchOpts = {
          ...urlOpts,
          args: [...(urlOpts.args || []), ...(flags || [])],
          headless:
            typeof headless !== 'undefined' ? headless : urlOpts.headless,
          ignoreDefaultArgs,
        };

        this.getChrome(launchOpts)
          .then(async (browser) => {
            jobdetaildebug(`${job.id}: Executing function.`);

            if (detached) {
              jobdebug(`${jobId}: Function is detached, resolving request.`);
              res.json({ id: jobId, trackingId });
            }
            const page = await this.newPage(browser);
            let beforeArgs = {};

            page.on('error', (error: Error) => {
              debug(`Error on page: ${error.message}`);
              if (!res.headersSent) {
                res.status(400).send(error.message);
              }
              doneOnce(error);
            });

            if (before) {
              debug(`Running before hook`);
              beforeArgs = await before({ page, browser, debug, jobId, code });
              debug(`Before hook done!`);
            }

            job.browser = browser;

            req.removeListener('close', earlyClose);
            browser.once('disconnected', doneOnce);
            req.once('close', () => {
              if (detached) {
                return;
              }
              debug(`Request terminated during execution, closing`);
              doneOnce();
            });

            return Promise.resolve(
              handler({
                ...beforeArgs,
                browser,
                context,
                page,
                timeout: this.config.connectionTimeout,
              }),
            ).then(async ({ data, type = 'text/plain', headers = {} } = {}) => {
              // If there's a specified "after" hook allow that to run
              if (after) {
                return after({
                  ...beforeArgs,
                  browser,
                  code,
                  debug,
                  done: doneOnce,
                  jobId,
                  page,
                  req,
                  res,
                });
              }

              debug(`Function complete, cleaning up.`);

              // If we've already responded (detached/error) we're done
              if (res.headersSent) {
                return doneOnce();
              }

              res.type(type);

              if (headers) {
                Object.keys(headers).forEach((key) => {
                  const hasValue =
                    Object.prototype.hasOwnProperty.call(headers, key) &&
                    headers[key] !== null &&
                    headers[key] !== undefined &&
                    headers[key] !== '';
                  if (hasValue) {
                    res.setHeader(key, headers[key]);
                  }
                });
              }

              if (Buffer.isBuffer(data)) {
                res.end(data, 'binary');
              } else if (type.includes('json')) {
                res.json(data);
              } else {
                res.send(data);
              }

              return doneOnce();
            });
          })
          .catch((error) => {
            if (!res.headersSent) {
              res.status(400).send(error.message);
            }
            debug(`Function errored, stopping Chrome: ${error.stack}`);
            doneOnce(error);
          });
      },
      {
        browser: null,
        close: () => this.cleanUpJob(job),
        id: jobId,
        onTimeout: () => {
          if (!res.headersSent) {
            jobdebug(`${job.id}: Function has timed-out, sending 408.`);
            return res.status(408).send('browserless function has timed-out');
          }
          jobdebug(
            `${job.id}: Function has timed-out but headers already sent...`,
          );
        },
        req,
        start: Date.now(),
      },
    );

    req.once('close', earlyClose);
    this.addJob(job);
  }

  public async runWebSocket(
    req: IHTTPRequest,
    socket: net.Socket,
    head: Buffer,
  ) {
    const jobId = utils.id();
    const parsedUrl = req.parsed;
    const route = parsedUrl.pathname || '/';

    jobdebug(`${jobId}: ${req.url}: Inbound WebSocket request.`);

    // Catch actual running pages and route them appropriately
    if (
      route.includes('/devtools/page') &&
      !route.includes(utils.jsonProtocolPrefix)
    ) {
      const session = await chromeHelper.findSessionForPageUrl(route);
      if (session && session.port) {
        const { port } = session;
        return this.proxyWsRequestToPort({ req, socket, head, port });
      }
      return this.server.rejectSocket({
        header: `HTTP/1.1 404 Not Found`,
        message: `Couldn't load session for ${route}`,
        req,
        socket,
      });
    }

    if (route.includes('/devtools/browser')) {
      const session = await chromeHelper.findSessionForBrowserUrl(route);
      if (session && session.port) {
        const { port } = session;
        return this.proxyWsRequestToPort({ req, socket, head, port });
      }
      return this.server.rejectSocket({
        header: `HTTP/1.1 404 Not Found`,
        message: `Couldn't load session for ${route}`,
        req,
        socket,
      });
    }

    if (!this.queue.hasCapacity) {
      jobdebug(
        `${jobId}: Too many concurrent and queued requests, rejecting with 429.`,
      );
      return this.server.rejectSocket({
        header: `HTTP/1.1 429 Too Many Requests`,
        message: `Too Many Requests`,
        metricType: 'rejected',
        hook: this.server.capacityFullHook,
        req,
        socket,
      });
    }

    if (await this.queue.overloaded()) {
      jobdebug(`${jobId}: Server under heavy load, rejecting with 503.`);
      return this.server.rejectSocket({
        header: `HTTP/1.1 503 Server under load`,
        message: `Server under heavy load, try again later`,
        hook: this.server.sessionCheckFailHook,
        metricType: 'unhealthy',
        req,
        socket,
      });
    }

    const opts = chromeHelper.convertUrlParamsToLaunchOpts(req);

    // If debug code is submitted, sandbox it in
    // its own process to prevent infinite/runaway scripts
    const handler = (done: IDone) => {
      const launchPromise = this.getChrome(opts);
      jobdebug(`${job.id}: Getting browser.`);

      const doneOnce = _.once((err) => {
        if (job.browser) {
          job.browser.removeListener('disconnected', doneOnce);
        }
        done(err);
      });

      launchPromise
        .then(async (browser) => {
          jobdebug(`${job.id}: Starting session.`);
          const browserWsEndpoint = browser._wsEndpoint;
          job.browser = browser;

          // Cleanup prior listener + listen for socket and browser close
          // events just in case something doesn't trigger
          socket.removeListener('close', earlyClose);
          socket.once('close', doneOnce);
          browser.once('disconnected', doneOnce);

          if (route.includes(PLAYWRIGHT_ROUTE) && browser._browserServer) {
            const playwrightRoute = browser._browserServer.wsEndpoint();
            jobdebug(
              `${job.id}: Proxying request to /playwright route: ${playwrightRoute}.`,
            );
            req.url = '';

            return playwrightRoute;
          }

          if (!route.includes('/devtools/page')) {
            jobdebug(
              `${job.id}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`,
            );
            req.url = route;

            return browserWsEndpoint;
          }

          const page: any = await browser.newPage();
          const port = browser._parsed.port;
          const pageLocation = `/devtools/page/${page._target._targetId}`;
          req.url = pageLocation;

          return `ws://127.0.0.1:${port}`;
        })
        .then((target) =>
          this.server.proxy.ws(req, socket, head, {
            target,
            changeOrigin: true,
          }),
        )
        .catch((error) => {
          jobdebug(
            error,
            `${job.id}: Issue launching Chrome or proxying traffic, failing request`,
          );
          doneOnce(error);
          socket.end();
        });
    };

    const jobProps = {
      browser: null,
      close: () => this.cleanUpJob(job),
      id: jobId,
      onTimeout: () => {
        jobdebug(`${job.id}: Job has timed-out, closing the WebSocket.`);
        socket.end();
      },
      req,
      start: Date.now(),
    };

    const job: IJob = Object.assign(handler, jobProps);

    const earlyClose = () => {
      jobdebug(
        `${job.id}: Websocket closed early, removing from queue and closing.`,
      );
      this.removeJob(job);
    };

    socket.once('close', earlyClose);
    this.addJob(job);
  }

  public async kill() {
    sysdebug(`Kill received, forcing queue and swarm to shutdown`);
    await Promise.all([
      ...this.queue.map(async (job: IJob) => job.close && job.close()),
      ...this.chromeSwarm.map(async (instance) => {
        const browser = await instance;
        await chromeHelper.closeBrowser(browser);
      }),
      this.queue.removeAllListeners(),
    ]);
    sysdebug(`Kill complete.`);
  }

  public async close() {
    sysdebug(`Closing queue and swarm gracefully`);

    if (this.queue.length) {
      sysdebug('Jobs are running, waiting for completion.');
      await new Promise((resolve) => {
        this.queue.on('end', () => {
          sysdebug(`All jobs complete, proceeding with close`);
          resolve(null);
        });
      });
    }

    if (this.chromeSwarm.length) {
      sysdebug('Instances of chrome in swarm, closing');
      await Promise.all(
        this.chromeSwarm.map(async (instance) => {
          const browser = await instance;
          await chromeHelper.closeBrowser(browser);
        }),
      );
    }

    return Promise.resolve();
  }

  private removeJob(job: IJob) {
    jobdebug(`${job.id}: Removing job from queue and cleaning up.`);
    job.close && job.close();
    this.queue.remove(job);
  }

  private addJob(job: IJob) {
    jobdebug(`${job.id}: Adding new job to queue.`);
    this.queue.add(job);
  }

  private async cleanUpJob(job: IJob) {
    const { browser } = job;
    jobdebug(`${job.id}: Cleaning up job`);

    if (!browser) {
      jobdebug(`${job.id}: No browser to cleanup, exiting`);
      return;
    }

    const closeChrome = async () => {
      jobdebug(`${job.id}: Browser not needed, closing`);
      await chromeHelper.closeBrowser(browser);

      jobdebug(`${job.id}: Browser cleanup complete.`);

      if (this.config.prebootChrome && browser._prebooted) {
        sysdebug(`Adding to Chrome swarm`);
        return this.chromeSwarm.push(
          this.launchChrome(chromeHelper.defaultLaunchArgs, true),
        );
      }
    };

    if (this.keepChromeInstance) {
      const timeAlive = Date.now() - browser._startTime;
      jobdebug(`${job.id}: Browser has been alive for ${timeAlive}ms`);

      if (timeAlive <= this.config.chromeRefreshTime) {
        jobdebug(`${job.id}: Pushing browser back into swarm, clearing pages`);
        const [blank, ...pages] = await browser.pages();
        pages.forEach((page) => page.close());
        blank && blank.goto('about:blank');
        jobdebug(`${job.id}: Cleanup done, pushing into swarm.`);
        return this.chromeSwarm.push(Promise.resolve(browser));
      }
    }

    // If it's marked as "keepalive", set a timer to kill it, and if we
    // see it again reset that timer, otherwise proceed with closing.
    if (browser._keepalive) {
      browser._keepaliveTimeout && clearTimeout(browser._keepaliveTimeout);
      jobdebug(
        `${job.id}: Browser marked as keep-alive, closing in ${browser._keepalive}ms`,
      );
      browser._keepaliveTimeout = global.setTimeout(
        closeChrome,
        browser._keepalive,
      );
      return;
    }

    closeChrome();
  }

  private async getChrome(opts: ILaunchOptions): Promise<IBrowser> {
    const browser: Promise<IBrowser> = new Promise(async (resolve) => {
      const canUseChromeSwarm =
        this.config.prebootChrome &&
        utils.canPreboot(opts, chromeHelper.defaultLaunchArgs);

      sysdebug(`Using pre-booted chrome: ${canUseChromeSwarm}`);

      if (!canUseChromeSwarm) {
        resolve(this.launchChrome(opts, false));
        return;
      }

      if (!this.chromeSwarm.length) {
        sysdebug(`Waiting for chrome instance to be added back`);
        this.chromeSwarm.once('push', async () => {
          sysdebug(`Got chrome instance in swarm`);
          const browser = this.chromeSwarm.shift() as IBrowser;
          resolve(browser);
        });
        return;
      }

      const browser = this.chromeSwarm.shift();
      resolve(browser);
      return;
    });

    return browser.then((browser) => {
      browser._trackingId = opts.trackingId || null;
      browser._keepalive = opts.keepalive || null;
      browser._blockAds = opts.blockAds;
      browser._pauseOnConnect = opts.pauseOnConnect;

      return browser;
    });
  }

  private async launchChrome(
    opts: ILaunchOptions,
    isPreboot = false,
    retries = 1,
  ): Promise<IBrowser> {
    const start = Date.now();

    return chromeHelper
      .launchChrome(opts, isPreboot)
      .then((chrome) => {
        sysdebug(`Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => {
        if (retries > 0) {
          const nextRetries = retries - 1;
          sysdebug(error, `Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(opts, isPreboot, nextRetries);
        }

        sysdebug(error, `Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }

  private async newPage(browser: IBrowser) {
    if (this.config.functionEnableIncognitoMode) {
      const browserContext = await browser.createIncognitoBrowserContext();
      return await browserContext.newPage();
    }
    return browser.newPage();
  }
}
