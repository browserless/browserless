import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import { NodeVM } from 'vm2';
import { BrowserlessServer } from './browserless-server';
import { ResourceMonitor } from './hardware-monitoring';
import { IChromeServiceConfiguration } from './models/browserless-options.interface';
import { debug } from './utils';

const queue = require('queue');
const oneMinute = 60 * 1000;

export class ChromeService {
  private readonly server: BrowserlessServer;
  private config: IChromeServiceConfiguration;
  private chromeSwarm: Array<Promise<puppeteer.Browser>>;
  private queue: any;
  private readonly resourceMonitor: ResourceMonitor;

  get queueSize() {
    return this.queue.length;
  }

  get queueConcurrency() {
    return this.queue.concurrency;
  }

  constructor(config: IChromeServiceConfiguration, server: BrowserlessServer, resourceMonitor: ResourceMonitor) {
    this.config = config;
    this.server = server;
    this.resourceMonitor = resourceMonitor;
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

  public getChrome(flags?: any): Promise<puppeteer.Browser> {
    const canUseChromeSwarm = !flags.length && !!this.chromeSwarm.length;
    const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(flags);

    return launchPromise as Promise<puppeteer.Browser>;
  }

  public addJob(job: any) {
    this.queue.push(job);
  }

  public autoUpdateQueue() {
    if (this.config.autoQueue && (this.queue.length < this.queue.concurrency)) {
      const isMachineStrained = this.resourceMonitor.isMachinedConstrained;
      this.queue.concurrency = isMachineStrained ? this.queue.length : this.config.maxConcurrentSessions;
    }
  }

  public onSessionSuccess() {
    debug(`Marking session completion`);
    this.server.currentStat.successful++;

    // if not keeping chrome instances alive,
    // closes and restarts chrome instance completely;
    // this will be fresh chrome instance
    if (!this.config.keepAlive) {
      this.addToChromeSwarm();
    }
  }

  public onSessionFail() {
    debug(`Marking session failure`);
    this.server.currentStat.error++;

    if (!this.config.keepAlive) {
      this.addToChromeSwarm();
    }
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
    const isMachineStrained = this.resourceMonitor.isMachinedConstrained;

    if (queueLength >= this.config.maxQueueLength) {
      return this.server.rejectReq(req, res, `Too Many Requests`);
    }

    if (this.config.autoQueue && (this.queue.length < this.queue.concurrency)) {
      this.queue.concurrency = isMachineStrained ? this.queue.length : this.config.maxConcurrentSessions;
    }

    if (queueLength >= this.queue.concurrency) {
      this.onQueued(req);
    }

    const vm = new NodeVM();
    const handler: (args) => Promise<any> = vm.run(code);

    debug(`${req.url}: Inbound function execution: ${JSON.stringify({ code, context })}`);

    const job: any = async () => {
      const launchPromise = this.chromeSwarm.length > 0 ?
        this.chromeSwarm.shift() :
        this.launchChrome();

      const browser = await launchPromise as puppeteer.Browser;
      const page = await browser.newPage();

      job.cleanup = () => this.config.keepAlive ?
        _.attempt(() => {
          this.reuseChromeInstance(browser);
          debug(`Added to chrome swarm: ${this.chromeSwarm.length} online`);
        }) :
        _.attempt(() => browser.close());

      job.browser = browser;

      return handler({ page, context })
        .then(({ data, type }) => {
          debug(`${req.url}: Function complete, cleaning up.`);
          res.type(type || 'text/plain');

          job.cleanup();

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
          job.cleanup();
        });
    };

    job.close = () => {
      if (job.cleanup) {
        job.cleanup();
      }

      if (!res.headersSent) {
        res.status(408).send('browserless function has timed-out');
      }
    };

    req.on('close', () => {
      debug(`${req.url}: Request has terminated, cleaning up.`);
      if (job.browser) {
        this.config.keepAlive ? this.reuseChromeInstance(job.browser) : job.browser.close();
      }
    });

    this.queue.push(job);
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

  private addToChromeSwarm() {
    if (this.config.prebootChrome && (this.chromeSwarm.length < this.queue.concurrency)) {
      this.chromeSwarm.push(this.launchChrome());
      debug(`Added Chrome instance to swarm, ${this.chromeSwarm.length} online`);
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
