import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless-server';
import { queue } from './queue';
import { debug } from './utils';

import { IChromeServiceConfiguration } from './models/browserless-options.interface';
import { IJob, IQueue } from './models/browserless-queue.interface';

const oneMinute = 60 * 1000;

export class ChromeService {
  private readonly server: BrowserlessServer;
  private config: IChromeServiceConfiguration;
  private chromeSwarm: Array<Promise<puppeteer.Browser>>;
  private queue: IQueue<IJob>;

  constructor(config: IChromeServiceConfiguration, server: BrowserlessServer) {
    this.config = config;
    this.server = server;
    this.queue = queue({
      autostart: true,
      concurrency: this.config.maxConcurrentSessions,
      timeout: this.config.connectionTimeout,
    });

    this.queue.on('success', this.onSessionSuccess.bind(this));
    this.queue.on('error', this.onSessionFail.bind(this));
    this.queue.on('timeout', this.onTimedOut.bind(this));

    this.chromeSwarm = [];

    if (this.config.prebootChrome) {
      debug(`Prebooting chrome swarm: ${this.config.maxConcurrentSessions} chrome instances starting`);

      for (let i = 0; i < this.config.maxConcurrentSessions; i++) {
        this.chromeSwarm.push(this.launchChrome());
      }

      process.on('SIGINT', () => {
        debug(`SIGTERM, shutting down Chromium`);

        this.chromeSwarm.forEach(async (chrome) => {
          const instance = await chrome;
          return instance.close();
        });

        process.exit(0);
      });

      setTimeout(() => this.refreshChromeSwarm(), this.config.chromeRefreshTime);
    }
  }

  get queueSize() {
    return this.queue.length;
  }

  get queueConcurrency() {
    return this.queue.concurrency;
  }

  public getChrome(flags?: any): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = !flags.length && !!this.chromeSwarm.length;
    const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(flags);

    return launchPromise as Promise<puppeteer.Browser>;
  }

  public addJob(job: IJob) {
    this.queue.push(job);
  }

  public removeJob(job: IJob) {
    this.cleanupChrome(job.browser);
    this.queue.remove(job);
  }

  public onSessionSuccess(_res, job: IJob) {
    debug(`Session completed successfully`);
    this.server.currentStat.successful++;
    this.cleanupChrome(job.browser);
  }

  public onSessionFail(error, job: IJob) {
    debug(`Session failed: ${error.message}`);
    this.server.currentStat.error++;
    this.cleanupChrome(job.browser);
  }

  public onTimedOut(next, job) {
    debug(`Timeout hit for session, closing. ${this.queue.length} in queue.`);
    job.close('HTTP/1.1 408 Request has timed out\r\n');
    this.server.currentStat.timedout = this.server.currentStat.timedout + 1;
    this.server.timeoutHook();
    next();
  }

  public onQueued(req) {
    debug(`${req.url}: Concurrency limit hit, queueing`);
    this.server.currentStat.queued = this.server.currentStat.queued + 1;
    this.server.queueHook();
  }

  public async reuseChromeInstance(instance: puppeteer.Browser) {
    const openPages = await instance.pages();
    openPages.forEach((page) => page.close());

    if (this.chromeSwarm.length < this.config.maxConcurrentSessions) {
      this.chromeSwarm.push(Promise.resolve(instance));
    }
    debug(`Added to chrome swarm: ${this.chromeSwarm.length} online`);
  }

  public async runFunction({ code, context, req, res }) {
    const queueLength = this.queue.length;

    if (queueLength >= this.config.maxQueueLength) {
      return this.server.rejectReq(req, res, `Too Many Requests`);
    }

    if (queueLength >= this.queue.concurrency) {
      this.onQueued(req);
    }

    const vm = new NodeVM();
    const handler: (args) => Promise<any> = vm.run(code);

    debug(`${req.url}: Inbound function execution: ${JSON.stringify({ code, context })}`);

    const job: IJob = async () => {
      const launchPromise = this.getChrome();
      const browser: puppeteer.Browser = await launchPromise;
      const page = await browser.newPage();

      job.browser = browser;

      return handler({ page, context })
        .then(({ data, type }) => {
          debug(`${req.url}: Function complete, cleaning up.`);
          res.type(type || 'text/plain');

          if (Buffer.isBuffer(data)) {
            return res.end(data, 'binary');
          }

          if (type.includes('json')) {
            return res.json(data);
          }

          return res.send(data);
        })
        .catch((error) => {
          res.status(500).send(error.message);
          debug(`${req.url}: Function errored, stopping Chrome`);
        });
    };

    req.on('close', () => {
      debug(`${req.url}: Request has terminated early, cleaning up.`);
      this.queue.remove(job);
    });

    this.addJob(job);
  }

  public async runWebsocket(req, socket, head) {
    const parsedUrl = url.parse(req.url, true);
    const route = parsedUrl.pathname || '/';
    const queueLength = this.queueSize;
    const debugCode = parsedUrl.query.code as string;
    const code = this.parseUserCode(debugCode);

    debug(`${req.url}: Inbound WebSocket request. ${queueLength} in queue.`);

    if (this.config.demoMode && !code) {
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (this.config.token && parsedUrl.query.token !== this.config.token) {
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (queueLength >= this.config.maxQueueLength) {
      return this.server.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`);
    }

    if (queueLength >= this.queueConcurrency) {
      this.onQueued(req);
    }

    const job: IJob = (done: () => {}) => {
      const flags = _.chain(parsedUrl.query)
        .pickBy((_value, param) => _.startsWith(param, '--'))
        .map((value, key) => `${key}${value ? `=${value}` : ''}`)
        .value();

      const launchPromise = this.getChrome(flags);
      debug(`${req.url}: WebSocket upgrade.`);

      launchPromise
        .then(async (browser) => {
          const browserWsEndpoint = browser.wsEndpoint();
          job.browser = browser;

          debug(`${req.url}: Chrome Launched.`);

          socket.once('close', done);

          if (!route.includes('/devtools/page')) {
            debug(`${req.url}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`);
            req.url = route;

            return browserWsEndpoint;
          }

          const page: any = await browser.newPage();
          const port = url.parse(browserWsEndpoint).port;
          const pageLocation = `/devtools/page/${page._target._targetId}`;
          req.url = pageLocation;

          if (code) {
            debug(`${req.url}: Executing user-submitted code.`);

            const sandbox = this.buildBrowserSandbox(page);
            const vm: any = new NodeVM({ sandbox });
            const handler = vm.run(code);

            handler({ page, context: {} });
          }

          return `ws://127.0.0.1:${port}`;
        })
        .then((target) => this.server.proxy.ws(req, socket, head, { target }))
        .catch((error) => {
          debug(error, `Issue launching Chrome or proxying traffic, failing request`);
          socket.close();
        });
    };

    socket.once('close', () => {
      debug(`${req.url}: Session closed, stopping Chrome. ${this.queueSize} now in queue`);
      this.removeJob(job);
    });

    this.addJob(job);
  }

  private refreshChromeSwarm(retries: number = 0) {
    if (retries > this.config.maxChromeRefreshRetries) {
      // forces refresh after max retries
      this.chromeSwarm.forEach((chromeInstance) => this.refreshChromeInstance(chromeInstance));
    }

    if (this.queue.length > this.chromeSwarm.length) {
      // tries to refresh later if more jobs than there are available chromes
      setTimeout(() => this.refreshChromeSwarm(retries + 1), oneMinute);
    }

    const chromeSwarmLength = this.chromeSwarm.length;
    for (let i = 0; i < chromeSwarmLength; i++) {
      const chromeInstance = this.chromeSwarm.shift() as Promise<puppeteer.Browser>;
      this.refreshChromeInstance(chromeInstance);
    }

    // will refresh again in set config time
    setTimeout(() => this.refreshChromeSwarm(), this.config.chromeRefreshTime);
  }

  private async refreshChromeInstance(instance: Promise<puppeteer.Browser>) {
    const chrome = await instance;
    chrome.close();

    if (this.config.keepAlive && (this.chromeSwarm.length < this.config.maxConcurrentSessions)) {
      this.chromeSwarm.push(this.launchChrome());
      debug(`Refreshing chrome swarm; currently ${this.chromeSwarm.length} online`);
    }
  }

  private buildBrowserSandbox(page: puppeteer.Page) {
    return {
      console: _.reduce(_.keys(console), (browserConsole, consoleMethod) => {
        browserConsole[consoleMethod] = (...args) => {
          args.unshift(consoleMethod);
          return page.evaluate((...args) => {
            const [consoleMethod, ...consoleArgs] = args;
            return console[consoleMethod](...consoleArgs);
          }, ...args);
        };

        return browserConsole;
      }, {}),
    };
  }

  private parseUserCode(code: string): string | null {
    if (!code) {
      return null;
    }
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

  private cleanupChrome(browser?: puppeteer.Browser) {
    // Close the browser if we're not keeping it around
    if (browser) {
      if (!this.config.keepAlive) {
        browser.close();
      }

      if (this.config.prebootChrome && (this.chromeSwarm.length < this.queue.concurrency)) {
        this.chromeSwarm.push(this.launchChrome());
        debug(`Added Chrome instance to swarm, ${this.chromeSwarm.length} online`);
      }
    }
  }

  private async launchChrome(flags: string[] = [], retries: number = 1): Promise<puppeteer.Browser> {
    const start = Date.now();
    debug('Chrome Starting');
    return puppeteer.launch({
      args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
    })
      .then((chrome) => {
        debug(`Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => {
        if (retries > 0) {
          const nextRetries = retries - 1;
          debug(error, `Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(flags, nextRetries);
        }

        debug(error, `Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }
}
