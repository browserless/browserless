import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { NodeVM } from 'vm2';

import { BrowserlessServer } from './browserless-server';
import { queue } from './queue';
import { getDebug, id } from './utils';

import { IChromeServiceConfiguration } from './models/browserless-options.interface';
import { IJob, IQueue } from './models/browserless-queue.interface';

const oneMinute = 60 * 1000;

const sysdebug = getDebug('system');
const jobdebug = getDebug('job');

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
      sysdebug(`Starting chrome swarm: ${this.config.maxConcurrentSessions} chrome instances starting`);

      for (let i = 0; i < this.config.maxConcurrentSessions; i++) {
        this.chromeSwarm.push(this.launchChrome());
      }

      process.on('SIGINT', () => {
        sysdebug(`SIGTERM, shutting down Chromium`);

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

  get concurrencySize() {
    return this.queue.concurrency;
  }

  get canRunImmediately() {
    return this.queueSize < this.concurrencySize;
  }

  get canQueue() {
    return this.queueSize < this.config.maxQueueLength;
  }

  get chromeSwarmSize() {
    return this.chromeSwarm.length;
  }

  get keepChromeInstance() {
    return (
      this.config.keepAlive &&
      this.config.prebootChrome &&
      this.chromeSwarmSize < this.concurrencySize
    );
  }

  get needsChromeInstances() {
    return this.config.prebootChrome && this.chromeSwarmSize < this.concurrencySize;
  }

  public async runFunction({ code, context, req, res }) {
    const jobId = id();
    jobdebug(`${jobId}: ${req.url} Inbound function request`);
    const queueLength = this.queue.length;

    if (queueLength >= this.config.maxQueueLength) {
      return this.server.rejectReq(req, res, `Too Many Requests`);
    }

    if (queueLength >= this.queue.concurrency) {
      this.onQueued(req);
    }

    const vm = new NodeVM();
    const handler: (args) => Promise<any> = vm.run(code);

    const job: IJob = async () => {
      const launchPromise = this.getChrome();
      const browser: puppeteer.Browser = await launchPromise;
      const page = await browser.newPage();

      jobdebug(`${job.id}: Executing function: ${JSON.stringify({ code, context })}`);

      job.browser = browser;

      return handler({ page, context })
        .then(({ data, type }) => {
          jobdebug(`${job.id}: Function complete, cleaning up.`);
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
          jobdebug(`${job.id}: Function errored, stopping Chrome`);
        });
    };

    job.id = jobId;

    req.on('close', () => {
      jobdebug(`${job.id}: Request has terminated early`);
      this.removeJob(job);
    });

    this.addJob(job);
  }

  public async runWebsocket(req, socket: NodeJS.Socket, head) {
    const jobId = id();
    const parsedUrl = url.parse(req.url, true);
    const route = parsedUrl.pathname || '/';
    const queueLength = this.queueSize;
    const debugCode = parsedUrl.query.code as string;

    jobdebug(`${jobId}: ${req.url}: Inbound WebSocket request.`);

    if (this.config.demoMode && !debugCode) {
      jobdebug(`${jobId}: No demo code sent, running in demo mode, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (this.config.token && parsedUrl.query.token !== this.config.token) {
      jobdebug(`${jobId}: No token sent, closing with 403.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
    }

    if (!this.canQueue) {
      jobdebug(`${jobId}: Too many concurrent and queued requests, rejecting with 429.`);
      return this.server.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`);
    }

    if (queueLength >= this.concurrencySize) {
      jobdebug(`${jobId}: Too many concurrent requests, queueing.`);
      this.onQueued(jobId);
    }

    const earlyClose = () => {
      jobdebug(`${job.id}: Websocket closed early, removing from queue and closing.`);
      this.removeJob(job);
    };

    const job: IJob = (done: () => {}) => {
      jobdebug(`${job.id}: Getting browser.`);
      const flags = _.chain(parsedUrl.query)
        .pickBy((_value, param) => _.startsWith(param, '--'))
        .map((value, key) => `${key}${value ? `=${value}` : ''}`)
        .value();

      const launchPromise = this.getChrome(flags);

      launchPromise
        .then(async (browser) => {
          jobdebug(`${job.id}: Starting session.`);
          const browserWsEndpoint = browser.wsEndpoint();
          const code = this.parseUserCode(debugCode, job);
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

          if (code) {
            jobdebug(`${job.id}: Executing user-submitted code.`);

            const sandbox = this.buildBrowserSandbox(page, job);
            const vm: any = new NodeVM({ sandbox });
            const handler = vm.run(code);

            handler({ page, context: {} });
          }

          return `ws://127.0.0.1:${port}`;
        })
        .then((target) => this.server.proxy.ws(req, socket, head, { target }))
        .catch((error) => {
          jobdebug(error, `${job.id}: Issue launching Chrome or proxying traffic, failing request`);
          done();
          socket.end();
        });
    };

    socket.once('close', earlyClose);
    this.addJob(job);
  }

  private removeJob(job: IJob) {
    jobdebug(`${job.id}: Removing job from queue and cleaning up.`);
    this.cleanUpJob(job);
    this.queue.remove(job);
  }

  private onSessionSuccess(_res, job: IJob) {
    jobdebug(`${job.id}: Recording successful stat and cleaning up.`);
    this.server.currentStat.successful++;
    this.cleanUpJob(job);
  }

  private onSessionFail(error, job: IJob) {
    jobdebug(`${job.id}: Recording failed stat, cleaning up: "${error.message}"`);
    this.server.currentStat.error++;
    this.cleanUpJob(job);
  }

  private onTimedOut(next, job: IJob) {
    jobdebug(`${job.id}: Recording timedout stat.`);
    this.server.currentStat.timedout++;
    this.cleanUpJob(job);
    this.server.timeoutHook();
    next();
  }

  private onQueued(job: IJob) {
    jobdebug(`${job.id}: Concurrency limit hit, queueing`);
    this.server.currentStat.queued++;
    this.server.queueHook();
  }

  private getChrome(flags: any = []): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = !flags.length && !!this.chromeSwarmSize;
    const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(flags);

    return launchPromise as Promise<puppeteer.Browser>;
  }

  private addJob(job: IJob) {
    jobdebug(`${job.id}: Adding new job to queue.`);
    this.queue.add(job);
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
      return this.chromeSwarm.push(this.launchChrome());
    }
    return sysdebug(`Chrome swarm is ok`);
  }

  private refreshChromeSwarm(retries: number = 0) {
    if (retries > this.config.maxChromeRefreshRetries) {
      sysdebug(`Refresh retries exhausted, forcing replacement of Chrome instances`);
      this.chromeSwarm.forEach((chromeInstance) => this.replaceChromeInstance(chromeInstance));
    }

    if (this.queueSize > this.chromeSwarmSize) {
      // tries to refresh later if more jobs than there are available chromes
      sysdebug(`Refreshing in ${oneMinute}ms due to queue size of ${this.queueSize}.`);
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

  private buildBrowserSandbox(page: puppeteer.Page, job: IJob): { console: any } {
    jobdebug(`${job.id}: Generating page sandbox`);
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

  private parseUserCode(code: string, job: IJob): string | null {
    if (!code) {
      return null;
    }
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

  private cleanUpJob(job: IJob) {
    const { browser } = job;
    jobdebug(`${job.id}: Cleaning up job`);

    if (!browser) {
      jobdebug(`${job.id}: No browser to cleanup, exiting`);
      return;
    }

    if (this.keepChromeInstance) {
      jobdebug(`${job.id}: Browser still needed`);
      return this.reuseChromeInstance(browser);
    }

    jobdebug(`${job.id}: Browser not needed, closing`);
    browser.close();

    jobdebug(`${job.id}: Browser cleanup complete, checking swarm.`);
    return this.checkChromeSwarm();
  }

  private async launchChrome(flags: string[] = [], retries: number = 1, job?: IJob): Promise<puppeteer.Browser> {
    const start = Date.now();
    const jobId = job && `${job.id}: ` ? job.id : '';
    jobdebug(`${jobId}Starting Chrome with flags: ${flags}`);

    return puppeteer.launch({
      args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
    })
      .then((chrome) => {
        jobdebug(`${jobId}Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => {
        if (retries > 0) {
          const nextRetries = retries - 1;
          jobdebug(error, `${jobId}Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(flags, nextRetries, job);
        }

        jobdebug(error, `${jobId}Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }
}
