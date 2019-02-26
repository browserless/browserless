import * as cookie from 'cookie';
import * as express from 'express';
import * as http from 'http';
import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { promisify } from 'util';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless';
import { convertUrlParamsToLaunchOpts, defaultLaunchArgs, launchChrome } from './chrome-helper';
import { Queue } from './queue';
import { BrowserlessSandbox } from './Sandbox';
import { codeCookieName, getDebug, getTimeout, id, isAuthorized } from './utils';

import { IChromeServiceConfiguration } from './models/options.interface';
import { IDone, IJob } from './models/queue.interface';

const oneMinute = 60 * 1000;

const systemDebug = getDebug('system');
const jobDebug = getDebug('job');
const verboseDebug = getDebug('verbose');
const XVFB = require('@cypress/xvfb');
const treeKill = require('tree-kill');

export interface IRunHTTP {
  code: string;
  context: any;
  req: express.Request;
  res: express.Response;
  detached?: boolean;
  before?: ({ page, browser, debug }) => Promise<any>;
  after?: (...args: any) => Promise<any>;
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
      systemDebug(`Starting chrome swarm: ${this.config.maxConcurrentSessions} chrome instances starting`);

      if (this.config.maxConcurrentSessions > 10) {
        process.setMaxListeners(this.config.maxConcurrentSessions + 2);
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
    const parsedUrl = url.parse(req.url || '', true);
    const timeout = getTimeout(parsedUrl);

    jobDebug(`${jobId}: ${req.url}: Inbound HTTP request. Context: ${JSON.stringify(context)}`);

    if (this.config.demoMode) {
      jobDebug(`${jobId}: Running in demo-mode, closing with 403.`);
      return this.server.rejectReq(req, res, 403, 'Unauthorized', false);
    }

    if (!this.queue.hasCapacity) {
      jobDebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectReq(req, res, 429, `Too Many Requests`);
    }

    if (detached) {
      jobDebug(`${jobId}: Function is detached, resolving request.`);
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
      jobDebug(`${job.id}: Function terminated prior to execution removing from queue`);
      this.removeJob(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        const debug = (message) => jobDebug(`${job.id}: ${message}`);
        debug(`Getting browser.`);

        const urlOpts = convertUrlParamsToLaunchOpts(parsedUrl);
        const launchOpts = {
          ...urlOpts,
          args: [...urlOpts.args || [], ...flags || []],
          headless: typeof headless !== 'undefined' ? headless : urlOpts.headless,
        };

        this.getChrome(launchOpts)
          .then(async (browser) => {
            verboseDebug(`${job.id}: Executing function.`);
            const page = await browser.newPage();
            let beforeArgs = {};

            page.on('error', (error) => {
              debug(`Error on page: ${error.message}`);
              if (!res.headersSent) {
                res.status(400).send(error.message);
              }
              done();
            });

            if (before) {
              debug(`Running before hook`);
              beforeArgs = await before({ page, browser, debug });
              debug(`Before hook done!`);
            }

            job.browser = browser;

            req.removeListener('close', earlyClose);
            req.once('close', () => {
              debug(`Request terminated during execution, closing`);
              done();
            });

            return Promise.resolve(handler({
              ...beforeArgs,
              browser,
              context,
              page,
            }))
              .then(async ({ data, type = 'text/plain' } = {}) => {

                // If there's a specified "after" hook allow that to run
                if (after) {
                  return after({
                    ...beforeArgs ,
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
        onTimeout: () => {
          if (!res.headersSent) {
            jobDebug(`${job.id}: Function has timed-out, sending 408.`);
            res.status(408).send('browserless function has timed-out');
          }
          jobDebug(`${job.id}: Function has timed-out but headers already sent...`);
        },
        req,
        timeout,
      },
    );

    req.once('close', earlyClose);
    this.addJob(job);
  }

  public async runWebSocket(req: http.IncomingMessage, socket: NodeJS.Socket, head: http.IncomingHttpHeaders) {
    const jobId = id();
    const parsedUrl: any = url.parse(req.url || '', true);
    const timeout = getTimeout(parsedUrl);
    const route = parsedUrl.pathname || '/';
    const hasDebugCode = parsedUrl.pathname && parsedUrl.pathname.includes('/debugger');
    const debugCode = hasDebugCode ?
      cookie.parse(req.headers.cookie)[codeCookieName] :
      '';

    jobDebug(`${jobId}: ${req.url}: Inbound WebSocket request.`);

    if (this.config.token && !isAuthorized(req, this.config.token)) {
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`, false);
    }

    if (this.config.demoMode && !debugCode) {
      jobDebug(`${jobId}: No demo code sent, running in demo mode, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`, false);
    }

    if (!this.queue.hasCapacity) {
      jobDebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`, true);
    }

    const opts = convertUrlParamsToLaunchOpts(parsedUrl);

    // If debug code is submitted, sandbox it in
    // its own process to prevent infinite/runaway scripts
    const handler = debugCode ?
      (done: IDone) => {
        jobDebug(`${job.id}: Starting debugger sandbox.`);
        const code = this.parseUserCode(debugCode, job);
        const timeout = this.config.connectionTimeout;
        const handler = new BrowserlessSandbox({
          code,
          opts,
          sandboxOpts: {
            builtin: this.config.functionBuiltIns,
            external: this.config.functionExternals,
          },
          timeout,
        });
        job.browser = handler;

        socket.removeListener('close', earlyClose);
        socket.once('close', done);

        handler.on('launched', ({ port, url }) => {
          req.url = url;
          jobDebug(`${job.id}: Got URL ${url}, proxying traffic to ${port}.`);
          this.server.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${port}` });
        });

        handler.on('error', (err) => {
          jobDebug(`${job.id}: Debugger crashed, exiting connection`);
          done(err);
          socket.end();
        });
      } :
      (done: IDone) => {
        jobDebug(`${job.id}: Getting browser.`);
        const launchPromise = this.getChrome(opts);

        launchPromise
          .then(async (browser) => {
            jobDebug(`${job.id}: Starting session.`);
            const browserWsEndpoint = browser.wsEndpoint();
            job.browser = browser;

            socket.removeListener('close', earlyClose);
            socket.once('close', done);

            if (!route.includes('/devtools/page')) {
              jobDebug(`${job.id}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`);
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
            jobDebug(error, `${job.id}: Issue launching Chrome or proxying traffic, failing request`);
            done(error);
            socket.end();
          });
      };

    const jobProps = {
      browser: null,
      close: () => this.cleanUpJob(job),
      id: jobId,
      onTimeout: () => {
        jobDebug(`${job.id}: Job has timed-out, closing the WebSocket.`);
        socket.end();
      },
      req,
      timeout,
    };

    const job: IJob = Object.assign(handler, jobProps);

    const earlyClose = () => {
      jobDebug(`${job.id}: Websocket closed early, removing from queue and closing.`);
      this.removeJob(job);
    };

    socket.once('close', earlyClose);
    this.addJob(job);
  }

  public async kill() {
    systemDebug(`Kill received, forcing queue and swarm to shutdown`);
    await Promise.all([
      ...this.queue.map(async (job: IJob) => job.close && job.close()),
      ...this.chromeSwarm.map(async (instance) => {
        const browser = await instance;
        await browser.close();
      }),
      this.queue.removeAllListeners(),
    ]);
    systemDebug(`Kill complete.`);
  }

  public async close() {
    systemDebug(`Close received, closing queue and swarm gracefully`);
    return new Promise((resolve) => {
      if (this.queue.length === 0) {
        return resolve(0);
      }

      this.queue.on('end', () => {
        systemDebug(`Queue drained`);
        resolve();
      });
    });
  }

  private removeJob(job: IJob) {
    jobDebug(`${job.id}: Removing job from queue and cleaning up.`);
    job.close && job.close();
    this.queue.remove(job);
  }

  private addJob(job: IJob) {
    jobDebug(`${job.id}: Adding new job to queue.`);
    this.queue.add(job);
  }

  private async cleanUpJob(job: IJob) {
    const { browser } = job;
    jobDebug(`${job.id}: Cleaning up job`);

    if (!browser) {
      jobDebug(`${job.id}: No browser to cleanup, exiting`);
      return;
    }

    if (browser instanceof BrowserlessSandbox) {
      return browser.close();
    }

    if (this.keepChromeInstance) {
      jobDebug(`${job.id}: Browser still needed`);
      return this.reuseChromeInstance(browser);
    }

    jobDebug(`${job.id}: Browser not needed, closing`);
    await browser.close();
    treeKill(browser.process().pid, 'SIGKILL');

    jobDebug(`${job.id}: Browser cleanup complete, checking swarm.`);
    return this.checkChromeSwarm();
  }

  private getChrome(opts: puppeteer.LaunchOptions): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = this.config.prebootChrome && _.isEqual(opts, defaultLaunchArgs);
    systemDebug(`Using pre-booted chrome: ${canUseChromeSwarm}`);
    const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(opts);

    return launchPromise as Promise<puppeteer.Browser>;
  }

  private async reuseChromeInstance(browser: puppeteer.Browser) {
    systemDebug('Clearing browser for reuse');

    const openPages = await browser.pages();
    openPages.forEach((page) => page.close());
    this.chromeSwarm.push(Promise.resolve(browser));

    return systemDebug(`Chrome swarm: ${this.chromeSwarmSize} online`);
  }

  private checkChromeSwarm() {
    if (this.needsChromeInstances) {
      systemDebug(`Adding to Chrome swarm`);
      return this.chromeSwarm.push(this.launchChrome(defaultLaunchArgs));
    }
    return systemDebug(`Chrome swarm is ok`);
  }

  private refreshChromeSwarm(retries: number = 0) {
    if (retries > this.config.maxChromeRefreshRetries) {
      systemDebug(`Refresh retries exhausted, forcing replacement of Chrome instances`);
      this.chromeSwarm.forEach((chromeInstance) => this.replaceChromeInstance(chromeInstance));
    }

    if (this.queue.length > this.chromeSwarmSize) {
      // tries to refresh later if more jobs than there are available chromes
      systemDebug(`Refreshing in ${oneMinute}ms due to queue size of ${this.queue.length}.`);
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
    systemDebug(`Replacing Chrome instance for re-use`);

    const chrome = await instance;
    chrome.close();

    this.checkChromeSwarm();
  }

  private parseUserCode(code: string, job: IJob): string {
    jobDebug(`${job.id}: Parsing user-uploaded code: "${code}"`);
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
        systemDebug(`Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => {
        if (retries > 0) {
          const nextRetries = retries - 1;
          systemDebug(error, `Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(opts, nextRetries);
        }

        systemDebug(error, `Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }
}
