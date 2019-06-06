import * as cookie from 'cookie';
import { IncomingMessage } from 'http';
import * as _ from 'lodash';
import * as net from 'net';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { promisify } from 'util';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless';
import { Queue } from './queue';
import { BrowserlessSandbox } from './Sandbox';
import { codeCookieName, getDebug, id, isAuthorized } from './utils';

import {
  convertUrlParamsToLaunchOpts,
  defaultLaunchArgs,
  findSessionForPageUrl,
  ILaunchOptions,
  launchChrome,
} from './chrome-helper';

import { IChromeServiceConfiguration } from './models/options.interface';
import { IDone, IJob } from './models/queue.interface';

const oneMinute = 60 * 1000;

const sysdebug = getDebug('system');
const jobdebug = getDebug('job');
const jobdetaildebug = getDebug('jobdetail');
const XVFB = require('@cypress/xvfb');
const treekill = require('tree-kill');

interface IBefore {
  page: puppeteer.Page;
  browser: puppeteer.Browser;
  debug: (message: string) => void;
  jobId: string;
  code: string;
}

export interface IRunHTTP {
  code: any;
  context: any;
  req: any;
  res: any;
  detached?: boolean;
  before?: (params: IBefore) => Promise<any>;
  after?: (...args: any) => Promise<any>;
  flags?: string[];
  options?: any;
  headless?: boolean;
}

export class PuppeteerProvider {
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
        process.setMaxListeners(this.config.maxConcurrentSessions + 3);
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
      await promisify(xvfb.start.bind(xvfb))();
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
  }: IRunHTTP) {
    const jobId = id();

    jobdebug(`${jobId}: ${req.url}: Inbound HTTP request. Context: ${JSON.stringify(context)}`);

    if (this.config.demoMode) {
      jobdebug(`${jobId}: Running in demo-mode, closing with 403.`);
      return this.server.rejectReq(req, res, 403, 'Unauthorized', false);
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
    const handler: (args: any) => Promise<any> = vm.run(code, `browserless-function-${jobId}.js`);
    const earlyClose = () => {
      jobdebug(`${job.id}: Function terminated prior to execution removing from queue`);
      this.removeJob(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        const doneOnce = _.once(done);
        const debug = (message: string) => jobdebug(`${job.id}: ${message}`);
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
            let beforeArgs = {};

            page.on('error', (error) => {
              debug(`Error on page: ${error.message}`);
              if (!res.headersSent) {
                res.status(400).send(error.message);
              }
              doneOnce();
            });

            if (before) {
              debug(`Running before hook`);
              beforeArgs = await before({ page, browser, debug, jobId, code });
              debug(`Before hook done!`);
            }

            job.browser = browser;

            req.removeListener('close', earlyClose);
            browser.once('disconnected', () => doneOnce());
            req.once('close', () => {
              debug(`Request terminated during execution, closing`);
              doneOnce();
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
            debug(`Function errored, stopping Chrome`);
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
            res.status(408).send('browserless function has timed-out');
          }
          jobdebug(`${job.id}: Function has timed-out but headers already sent...`);
        },
        req,
        start: Date.now(),
      },
    );

    req.once('close', earlyClose);
    this.addJob(job);
  }

  public async runWebSocket(req: IncomingMessage, socket: net.Socket, head: Buffer) {
    const jobId = id();
    const parsedUrl: any = url.parse(req.url || '', true);
    const route = parsedUrl.pathname || '/';
    const hasDebugCode = parsedUrl.pathname && parsedUrl.pathname.includes('/debugger');
    const debugCode = hasDebugCode ?
      cookie.parse(req.headers.cookie || '')[codeCookieName] :
      '';

    jobdebug(`${jobId}: ${req.url}: Inbound WebSocket request.`);

    if (route.includes('/devtools/page')) {
      const session = await findSessionForPageUrl(route);
      if (session && session.port) {
        const { port } = session;
        return this.proxyWsRequestToPort({ req, socket, head, port });
      }
      return this.server.rejectSocket(req, socket, `HTTP/1.1\n404 Not Found`, false);
    }

    if (this.config.token && !isAuthorized(req, this.config.token)) {
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`, false);
    }

    if (this.config.demoMode && !debugCode) {
      jobdebug(`${jobId}: No demo code sent, running in demo mode, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`, false);
    }

    if (!this.queue.hasCapacity) {
      jobdebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`, true);
    }

    const opts = convertUrlParamsToLaunchOpts(req);

    // If debug code is submitted, sandbox it in
    // its own process to prevent infinite/runaway scripts
    const handler = debugCode ?
      (done: IDone) => {
        jobdebug(`${job.id}: Starting debugger sandbox.`);
        const doneOnce = _.once(done);
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
        socket.once('close', doneOnce);

        handler.on('launched', ({ port, url }) => {
          req.url = url;
          jobdebug(`${job.id}: Got URL ${url}, proxying traffic to ${port}.`);
          this.server.proxy.ws(req, socket, head, { target: `ws://127.0.0.1:${port}` });
        });

        handler.on('error', (err) => {
          jobdebug(`${job.id}: Debugger crashed, exiting connection`);
          doneOnce(err);
          socket.end();
        });
      } :
      (done: IDone) => {
        jobdebug(`${job.id}: Getting browser.`);
        const doneOnce = _.once(done);
        const launchPromise = this.getChrome(opts);

        launchPromise
          .then(async (browser) => {
            jobdebug(`${job.id}: Starting session.`);
            const browserWsEndpoint = browser.wsEndpoint();
            job.browser = browser;

            // Cleanup prior listener + listen for socket and browser close
            // events just in case something doesn't trigger
            socket.removeListener('close', earlyClose);
            socket.once('close', doneOnce);
            browser.once('disconnected', doneOnce);

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
      jobdebug(`${job.id}: Websocket closed early, removing from queue and closing.`);
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
        await browser.close();
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
          resolve();
        });
      });
    }

    if (this.chromeSwarm.length) {
      sysdebug('Instances of chrome in swarm, closing');
      await Promise.all(this.chromeSwarm.map(async (instance) => {
        const browser = await instance;
        return browser.close();
      }));
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

    if (browser instanceof BrowserlessSandbox) {
      return browser.close();
    }

    if (this.keepChromeInstance) {
      jobdebug(`${job.id}: Browser still needed`);
      return this.reuseChromeInstance(browser);
    }

    jobdebug(`${job.id}: Browser not needed, closing`);
    browser.close().catch(_.noop);
    treekill(browser.process().pid, 'SIGKILL');

    jobdebug(`${job.id}: Browser cleanup complete, checking swarm.`);
    return this.checkChromeSwarm();
  }

  private getChrome(opts: ILaunchOptions): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = this.config.prebootChrome && _.isEqual(opts, defaultLaunchArgs);
    sysdebug(`Using pre-booted chrome: ${canUseChromeSwarm}`);
    const priorChrome = canUseChromeSwarm && this.chromeSwarm.shift();

    return (priorChrome || this.launchChrome(opts));
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

  private async launchChrome(opts: ILaunchOptions, retries = 1): Promise<puppeteer.Browser> {
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
