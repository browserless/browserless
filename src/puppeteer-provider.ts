import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { promisify } from 'util';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless-web-server';
import { convertUrlParamsToLaunchOpts, defaultLaunchArgs, launchChrome } from './chrome-helper';
import { Queue } from './queue';
import { BrowserlessSandbox } from './Sandbox';
import { getDebug, id } from './utils';

import { IChromeServiceConfiguration } from './models/options.interface';
import { IDone, IJob } from './models/queue.interface';

const oneMinute = 60 * 1000;

const sysdebug = getDebug('system');
const jobdebug = getDebug('job');
const jobdetaildebug = getDebug('jobdetail');
const XVFB = require('@cypress/xvfb');

export interface IRunHTTP {
  code: any;
  context: any;
  req: any;
  res: any;
  detached?: boolean;
  before?: ({ page, browser, debug }) => Promise<any>;
  after?: ({ page, browser, jobId, req, res, done, debug }) => Promise<any>;
  flags?: string[];
  options?: any;
  headless?: boolean;
}

export class ChromeService {
  private readonly server: BrowserlessServer;
  private config: IChromeServiceConfiguration;
  private chromeSwarm: Array<Promise<puppeteer.Browser>>;
  private queue: Queue;

  constructor(config: IChromeServiceConfiguration, server: BrowserlessServer, queue: Queue) {
    this.config = config;
    this.server = server;
    this.queue = queue;

    this.chromeSwarm = [];
  }

  get chromeSwarmSize() {
    return this.chromeSwarm.length;
  }

  get keepChromeInstance() {
    return (
      this.config.keepAlive &&
      this.config.prebootChrome &&
      this.chromeSwarmSize < this.queue.concurrencySize
    );
  }

  get needsChromeInstances() {
    return (
      this.config.prebootChrome &&
      this.chromeSwarmSize < this.queue.concurrencySize
    );
  }

  public async start() {
    if (this.config.prebootChrome) {
      sysdebug(`Starting chrome swarm: ${this.config.maxConcurrentSessions} chrome instances starting`);

      if (this.config.maxConcurrentSessions > 10) {
        process.setMaxListeners(this.config.maxConcurrentSessions + 1);
      }

      const launching = Array.from({ length: this.config.maxConcurrentSessions }, () => {
        const chrome = this.launchChrome(defaultLaunchArgs);
        this.chromeSwarm.push(chrome);
        return chrome;
      });

      setTimeout(() => this.refreshChromeSwarm(), this.config.chromeRefreshTime);

      return Promise.all(launching);
    }

    if (this.config.enableXvfb) {
      const xvfb = new XVFB();
      const start = promisify(xvfb.start.bind(xvfb));
      await start();
    }

    return Promise.resolve();
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
  }: IRunHTTP) {
    const jobId = id();

    jobdebug(`${jobId}: ${req.url}: Inbound HTTP request. Context: ${JSON.stringify(context)}`);

    if (this.config.demoMode) {
      jobdebug(`${jobId}: Running in demo-mode, closing with 403.`);
      return this.server.rejectReq(req, res, 403, 'Unauthorized');
    }

    if (!this.queue.hasCapacity) {
      jobdebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectReq(req, res, 429, `Too Many Requests`);
    }

    if (detached) {
      jobdebug(`${jobId}: Function is detached, resolving request.`);
      res.json({ id: jobId });
    }

    const vm = new NodeVM({
      require: {
        builtin: this.config.functionBuiltIns,
        external: this.config.functionExternals,
        root: './',
      },
    });
    const handler: (args) => Promise<any> = vm.run(code, `browserless-function-${jobId}.js`);
    const earlyClose = () => {
      jobdebug(`${job.id}: Function terminated prior to execution removing from queue`);
      this.removeJob(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        const debug = (message) => jobdebug(`${job.id}: ${message}`);
        debug(`Getting browser.`);

        const urlOpts = convertUrlParamsToLaunchOpts(req);

        const launchOpts = {
          ...urlOpts,
          args: [...urlOpts.args || [], ...flags || []],
          headless: typeof headless !== 'undefined' ? headless : urlOpts.headless,
        };

        this.getChrome(launchOpts)
          .then(async (browser) => {
            jobdetaildebug(`${job.id}: Executing function.`);
            const page = await browser.newPage();

            page.on('error', (error) => {
              debug(`Error on page: ${error.message}`);
              if (!res.headersSent) {
                res.status(400).send(error.message);
              }
              done();
            });

            if (before) {
              debug(`Running before hook`);
              await before({ page, browser, debug });
              debug(`Before hook done!`);
            }

            job.browser = browser;

            req.removeListener('close', earlyClose);
            req.once('close', () => {
              debug(`Request terminated during execution, closing`);
              done();
            });

            return Promise.resolve(handler({ page, context, browser }))
              .then(async ({ data, type = 'text/plain' } = {}) => {

                // If there's a specified "after" hook allow that to run
                if (after) {
                  return after({
                    browser,
                    debug,
                    done,
                    jobId,
                    page,
                    req,
                    res,
                  });
                }

                debug(`Function complete, cleaning up.`);

                // If we've already responded (detached/error) we're done
                if (res.headersSent) {
                  return done();
                }

                res.type(type);

                if (Buffer.isBuffer(data)) {
                  res.end(data, 'binary');
                } else if (type.includes('json')) {
                  res.json(data);
                } else {
                  res.send(data);
                }

                return done();
              });
          })
          .catch((error) => {
            if (!res.headersSent) {
              res.status(400).send(error.message);
            }
            debug(`Function errored, stopping Chrome`);
            done(error);
          });
      },
      {
        browser: null,
        close: () => this.cleanUpJob(job),
        id: jobId,
        timeout: () => {
          if (!res.headersSent) {
            jobdebug(`${job.id}: Function has timed-out, sending 408.`);
            res.status(408).send('browserless function has timed-out');
          }
          jobdebug(`${job.id}: Function has timed-out but headers already sent...`);
        },
      },
    );

    req.once('close', earlyClose);
    this.addJob(job);
  }

  public async runWebSocket(req, socket: NodeJS.Socket, head) {
    const jobId = id();
    const parsedUrl: any = url.parse(req.url, true);
    const route = parsedUrl.pathname || '/';
    const hasDebugCode = parsedUrl.pathname && parsedUrl.pathname.includes('/debugger/');
    const debugCode = hasDebugCode ?
      parsedUrl.pathname.replace('/debugger/', '') :
      '';

    jobdebug(`${jobId}: ${req.url}: Inbound WebSocket request.`);

    if (this.config.demoMode && !debugCode) {
      jobdebug(`${jobId}: No demo code sent, running in demo mode, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (this.config.token && !req.url.includes(this.config.token)) {
      jobdebug(`${jobId}: No token sent, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (!this.queue.hasCapacity) {
      jobdebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`);
    }

    const opts = convertUrlParamsToLaunchOpts(req);

    // If debug code is submitted, sandbox it in
    // its own process to prevent infinite/runaway scripts
    const handler = debugCode ?
      (done: IDone) => {
        jobdebug(`${job.id}: Starting debugger sandbox.`);
        const code = this.parseUserCode(decodeURIComponent(debugCode), job);
        const timeout = this.config.connectionTimeout;
        const handler = new BrowserlessSandbox({
          code,
          opts,
          timeout,
        });
        job.browser = handler;

        socket.removeListener('close', earlyClose);
        socket.once('close', done);

        handler.on('launched', ({ port, url }) => {
          req.url = url;
          jobdebug(`${job.id}: Got URL ${url}, proxying traffic to ${port}.`);
          this.server.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${port}` });
        });

        handler.on('error', (err) => {
          jobdebug(`${job.id}: Debugger crashed, exiting connection`);
          done(err);
          socket.end();
        });
      } :
      (done: IDone) => {
        jobdebug(`${job.id}: Getting browser.`);
        const launchPromise = this.getChrome(opts);

        launchPromise
          .then(async (browser) => {
            jobdebug(`${job.id}: Starting session.`);
            const browserWsEndpoint = browser.wsEndpoint();
            job.browser = browser;

            socket.removeListener('close', earlyClose);
            socket.once('close', done);

            if (!route.includes('/devtools/page')) {
              jobdebug(`${job.id}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`);
              req.url = route;

              return browserWsEndpoint;
            }

            const page: any = await browser.newPage();
            const port = url.parse(browserWsEndpoint).port;
            const pageLocation = `/devtools/page/${page._target._targetId}`;
            req.url = pageLocation;

            return `ws://127.0.0.1:${port}`;
          })
          .then((target) => this.server.proxy.ws(req, socket, head, { target }))
          .catch((error) => {
            jobdebug(error, `${job.id}: Issue launching Chrome or proxying traffic, failing request`);
            done(error);
            socket.end();
          });
      };

    const jobProps = {
      browser: null,
      close: () => this.cleanUpJob(job),
      id: jobId,
      timeout: () => {
        jobdebug(`${job.id}: Job has timed-out, closing the WebSocket.`);
        socket.end();
      },
    };

    const job: IJob = Object.assign(handler, jobProps);

    const earlyClose = () => {
      jobdebug(`${job.id}: Websocket closed early, removing from queue and closing.`);
      this.removeJob(job);
    };

    socket.once('close', earlyClose);
    this.addJob(job);
  }

  public async close() {
    sysdebug(`Close received, forcing queue and swarm to shutdown`);
    await Promise.all([
      ...this.queue.map(async (job) => job.close()),
      ...this.chromeSwarm.map(async (instance) => {
        const browser = await instance;
        await browser.close();
      }),
    ]);
    sysdebug(`Close complete.`);
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

    if (browser instanceof BrowserlessSandbox) {
      return browser.close();
    }

    if (this.keepChromeInstance) {
      jobdebug(`${job.id}: Browser still needed`);
      return this.reuseChromeInstance(browser);
    }

    jobdebug(`${job.id}: Browser not needed, closing`);
    await browser.close();

    jobdebug(`${job.id}: Browser cleanup complete, checking swarm.`);
    return this.checkChromeSwarm();
  }

  private getChrome(opts: puppeteer.LaunchOptions): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = _.isEqual(opts, defaultLaunchArgs);
    const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(opts);

    return launchPromise as Promise<puppeteer.Browser>;
  }

  private async reuseChromeInstance(browser: puppeteer.Browser) {
    sysdebug('Clearing browser for reuse');

    const openPages = await browser.pages();
    openPages.forEach((page) => page.close());
    this.chromeSwarm.push(Promise.resolve(browser));

    return sysdebug(`Chrome swarm: ${this.chromeSwarmSize} online`);
  }

  private checkChromeSwarm() {
    if (this.needsChromeInstances) {
      sysdebug(`Adding to Chrome swarm`);
      return this.chromeSwarm.push(this.launchChrome(defaultLaunchArgs));
    }
    return sysdebug(`Chrome swarm is ok`);
  }

  private refreshChromeSwarm(retries: number = 0) {
    if (retries > this.config.maxChromeRefreshRetries) {
      sysdebug(`Refresh retries exhausted, forcing replacement of Chrome instances`);
      this.chromeSwarm.forEach((chromeInstance) => this.replaceChromeInstance(chromeInstance));
    }

    if (this.queue.length > this.chromeSwarmSize) {
      // tries to refresh later if more jobs than there are available chromes
      sysdebug(`Refreshing in ${oneMinute}ms due to queue size of ${this.queue.length}.`);
      setTimeout(() => this.refreshChromeSwarm(retries + 1), oneMinute);
    }

    const chromeSwarmLength = this.chromeSwarmSize;
    for (let i = 0; i < chromeSwarmLength; i++) {
      const chromeInstance = this.chromeSwarm.shift() as Promise<puppeteer.Browser>;
      this.replaceChromeInstance(chromeInstance);
    }

    // will refresh again in set config time
    setTimeout(() => this.refreshChromeSwarm(), this.config.chromeRefreshTime);
  }

  private async replaceChromeInstance(instance: Promise<puppeteer.Browser>) {
    sysdebug(`Replacing Chrome instance for re-use`);

    const chrome = await instance;
    chrome.close();

    this.checkChromeSwarm();
  }

  private parseUserCode(code: string, job: IJob): string {
    jobdebug(`${job.id}: Parsing user-uploaded code: "${code}"`);
    const codeWithDebugger = code.replace('debugger', 'await page.evaluate(() => { debugger; })');
    return codeWithDebugger.includes('module.exports') ?
      codeWithDebugger :
      `module.exports = async ({ page, context: {} }) => {
        try {
          ${codeWithDebugger}
        } catch (error) {
          console.error('Unhandled Error:', error.message, error.stack);
        }
      }`;
  }

  private async launchChrome(opts: puppeteer.LaunchOptions, retries = 1): Promise<puppeteer.Browser> {
    const start = Date.now();

    return launchChrome(opts)
      .then((chrome) => {
        sysdebug(`Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => {
        if (retries > 0) {
          const nextRetries = retries - 1;
          sysdebug(error, `Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(opts, nextRetries);
        }

        sysdebug(error, `Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }
}
