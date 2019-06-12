import * as cookie from 'cookie';
import * as cors from 'cors';
import * as express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as _ from 'lodash';
import { Socket } from 'net';
import * as os from 'os';
import * as path from 'path';

import {
  asyncWsHandler,
  clearBrowserlessDataDirs,
  getDebug,
  isAuthorized,
  isWebdriverAuthorized,
  readRequestBody,
  safeParse,
  tokenCookieName,
  writeFile,
} from './utils';

import { ResourceMonitor } from './hardware-monitoring';
import { IBrowserlessOptions } from './models/options.interface';
import { IDone, IJob } from './models/queue.interface';
import { PuppeteerProvider } from './puppeteer-provider';
import { Queue } from './queue';
import { getRoutes } from './routes';
import { WebDriver } from './webdriver-provider';

const debug = getDebug('server');

const request = require('request');
const twentyFourHours = 1000 * 60 * 60 * 24;
const thirtyMinutes = 30 * 60 * 1000;
const fiveMinutes = 5 * 60 * 1000;
const maxStats = 12 * 24 * 7; // 7 days @ 5-min intervals

const webDriverPath = '/webdriver/session';
const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');

const beforeHook = fs.existsSync(beforeHookPath) ?
  require(beforeHookPath) :
  () => true;

const afterHook = fs.existsSync(afterHookPath) ?
  require(afterHookPath) :
  () => true;

export class BrowserlessServer {
  public currentStat: IBrowserlessStats;
  public readonly rejectHook: () => void;
  public readonly queueHook: () => void;
  public readonly timeoutHook: () => void;
  public readonly healthFailureHook: () => void;
  public readonly queue: Queue;
  public proxy: httpProxy;

  private config: IBrowserlessOptions;
  private stats: IBrowserlessStats[];
  private httpServer: http.Server;
  private readonly resourceMonitor: ResourceMonitor;
  private puppeteerProvider: PuppeteerProvider;
  private webdriver: WebDriver;
  private metricsInterval: NodeJS.Timeout;
  private workspaceDir: IBrowserlessOptions['workspaceDir'];

  constructor(opts: IBrowserlessOptions) {
    // The backing queue doesn't let you set a max limitation
    // on length, so we add concurrent sessions + queue length
    // to determine the `queue` array's max length
    const debounceOpts = { leading: true, trailing: false };
    this.config = opts;
    this.queue = new Queue({
      autostart: true,
      concurrency: this.config.maxConcurrentSessions,
      maxQueueLength: this.config.maxQueueLength,
      ...this.config.connectionTimeout !== -1 && {
        timeout: this.config.connectionTimeout,
      },
    });
    this.resourceMonitor = new ResourceMonitor(this.config.maxCPU, this.config.maxMemory);
    this.puppeteerProvider = new PuppeteerProvider(opts, this, this.queue);
    this.webdriver = new WebDriver(this.queue);
    this.stats = [];

    this.proxy = httpProxy.createProxyServer();
    this.proxy.on('error', (err: Error, _req, res) => {
      if (res.writeHead) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }

      debug(`Issue communicating with Chrome: "${err.message}"`);
      res.end(`Issue communicating with Chrome`);
    });

    function restartOnFailure() {
      if (opts.exitOnHealthFailure) {
        process.exit(1);
      }
    }

    this.queueHook = opts.queuedAlertURL ?
      _.debounce(() => {
        debug(`Calling web-hook for queued session(s): ${opts.queuedAlertURL}`);
        request(opts.queuedAlertURL, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.rejectHook = opts.rejectAlertURL ?
      _.debounce(() => {
        debug(`Calling web-hook for rejected session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.timeoutHook = opts.timeoutAlertURL ?
      _.debounce(() => {
        debug(`Calling web-hook for timed-out session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.healthFailureHook = opts.healthFailureURL ?
      _.debounce(() => {
        debug(`Calling web-hook for health-failure: ${opts.healthFailureURL}`);
        request(opts.healthFailureURL, restartOnFailure);
      }, thirtyMinutes, debounceOpts) :
      restartOnFailure;

    this.queue.on('success', this.onSessionSuccess.bind(this));
    this.queue.on('error', this.onSessionFail.bind(this));
    this.queue.on('timeout', this.onTimedOut.bind(this));
    this.queue.on('queued', this.onQueued.bind(this));

    debug(this.config, `Final Options`);

    this.resetCurrentStat();

    // If we're saving metrics, load any potential prior-state
    if (opts.metricsJSONPath) {
      try {
        const priorMetrics = require(opts.metricsJSONPath);
        this.stats = priorMetrics;
      } catch (err) {
        debug(`Couldn't load metrics at path ${opts.metricsJSONPath}, setting to empty.`);
      }
    }

    const hasWorkspaceDir = fs.existsSync(opts.workspaceDir);
    this.workspaceDir = hasWorkspaceDir ? opts.workspaceDir : os.tmpdir();

    if (!hasWorkspaceDir) {
      debug(`The download-directory "${opts.workspaceDir}" doesn't exist, setting it to "${this.workspaceDir}"`);
    }

    this.metricsInterval = setInterval(this.recordMetrics.bind(this), fiveMinutes);

    const boundClose = this.close.bind(this);

    process.on('SIGTERM', boundClose);
    process.on('SIGINT', boundClose);
  }

  public getMetrics() {
    return [...this.stats, this.currentStat];
  }

  public getConfig() {
    return this.config;
  }

  public getPressure() {
    const queueLength = this.queue.length;
    const queueConcurrency = this.queue.concurrencySize;
    const concurrencyMet = queueLength >= queueConcurrency;

    return {
      date: Date.now(),
      isAvailable: queueLength < this.config.maxQueueLength,
      queued: concurrencyMet ? queueLength - queueConcurrency : 0,
      recentlyRejected: this.currentStat.rejected,
      running: concurrencyMet ? queueConcurrency : queueLength,
    };
  }

  public async startServer(): Promise<any> {
    await this.puppeteerProvider.start();

    return new Promise(async (resolve) => {
      // Make sure we have http server setup with some headroom
      // for timeouts (so we can respond with appropriate http codes)
      const httpTimeout = this.config.connectionTimeout === -1 ?
        twentyFourHours :
        this.config.connectionTimeout + 100;
      const app = express();

      const routes = getRoutes({
        getConfig: this.getConfig.bind(this),
        getMetrics: this.getMetrics.bind(this),
        getPressure: this.getPressure.bind(this),
        puppeteerProvider: this.puppeteerProvider,
        workspaceDir: this.workspaceDir,
      });

      if (this.config.enableCors) {
        app.use(cors());
      }

      if (this.config.enableDebugger) {
        app.use('/', express.static('./debugger'));
      }

      app.use(routes);

      return this.httpServer = http
        .createServer(async (req, res) => {
          const beforeResults = await beforeHook({ req, res });

          if (!beforeResults) {
            return res.end();
          }

          // Handle webdriver requests early, which handles it's own auth
          if (req.url && req.url.includes(webDriverPath)) {
            return this.handleWebDriver(req, res);
          }

          if (this.config.token && !isAuthorized(req, this.config.token)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Unauthorized');
          }

          // Handle token auth
          const cookies = cookie.parse(req.headers.cookie || '');

          if (!cookies[tokenCookieName] && this.config.token) {
            const cookieToken = cookie.serialize(tokenCookieName, this.config.token, {
              httpOnly: true,
              maxAge: twentyFourHours / 1000,
            });
            res.setHeader('Set-Cookie', cookieToken);
          }

          return app(req, res);
        })
        .on('upgrade', asyncWsHandler(async (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
          const beforeResults = await beforeHook({ req });

          if (!beforeResults) {
            return socket.end();
          }

          return this.puppeteerProvider.runWebSocket(req, socket, head);
        }))
        .setTimeout(httpTimeout)
        .listen(this.config.port, this.config.host, resolve);
    });
  }

  public async kill() {
    debug(`Kill received, forcefully closing`);

    clearInterval(this.metricsInterval);
    process.removeAllListeners();
    this.proxy.removeAllListeners();
    this.resourceMonitor.close();
    await clearBrowserlessDataDirs();

    await Promise.all([
      new Promise((resolve) => this.httpServer.close(resolve)),
      new Promise((resolve) => {
        this.proxy.close();
        resolve();
      }),
      this.puppeteerProvider.kill(),
      this.webdriver.close(),
    ]);

    debug(`Successfully shutdown, exiting`);
  }

  public async close() {
    debug(`Close received, gracefully closing`);

    clearInterval(this.metricsInterval);
    process.removeAllListeners();
    this.proxy.removeAllListeners();
    this.resourceMonitor.close();
    await clearBrowserlessDataDirs();

    await new Promise((resolve) => {
      debug(`Closing server`);
      this.httpServer.close(resolve);
    });

    await this.puppeteerProvider.close();

    debug(`Successfully shutdown, exiting`);

    process.exit(0);
  }

  public rejectReq(req: express.Request, res: express.Response, code: number, message: string, recordStat = true) {
    debug(`${req.url}: ${message}`);
    res.status(code).send(message);
    if (recordStat) {
      this.currentStat.rejected++;
    }
    this.rejectHook();
  }

  public rejectSocket(req: http.IncomingMessage, socket: Socket, message: string, recordStat = true) {
    debug(`${req.url}: ${message}`);
    socket.end(message);
    if (recordStat) {
      this.currentStat.rejected++;
    }
    this.rejectHook();
  }

  private async handleWebDriver(req: http.IncomingMessage, res: http.ServerResponse) {
    const sessionPathMatcher = new RegExp('^' + webDriverPath + '/\\w+$');

    const isStarting = req.method && req.method.toLowerCase() === 'post' && req.url === webDriverPath;
    const isClosing = req.method && req.method.toLowerCase() === 'delete' && sessionPathMatcher.test(req.url || '');

    if (isStarting) {
      const body = await readRequestBody(req);
      const parsed = safeParse(body);

      if (!parsed) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request, no body posted');
      }

      if (this.config.token && !isWebdriverAuthorized(req, parsed, this.config.token)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Unauthorized');
      }

      return this.webdriver.start(req, res);
    }

    if (isClosing) {
      return this.webdriver.closeSession(req, res);
    }

    return this.webdriver.proxySession(req, res);
  }

  private onSessionSuccess(_res: express.Response, job: IJob) {
    debug(`${job.id}: Recording successful stat and cleaning up.`);
    this.currentStat.successful++;
    job.close && job.close();
    afterHook({
      req: job.req,
      start: job.start,
      status: 'successful',
    });
  }

  private onSessionFail(error: Error, job: IJob) {
    debug(`${job.id}: Recording failed stat, cleaning up: "${error.message}"`);
    this.currentStat.error++;
    job.close && job.close();
    afterHook({
      req: job.req,
      start: job.start,
      status: 'error',
    });
  }

  private onTimedOut(next: IDone, job: IJob) {
    debug(`${job.id}: Recording timedout stat.`);
    this.currentStat.timedout++;
    this.timeoutHook();
    job.onTimeout && job.onTimeout();
    job.close && job.close();
    afterHook({
      req: job.req,
      start: job.start,
      status: 'timedout',
    });
    next();
  }

  private onQueued(id: string) {
    debug(`${id}: Recording queued stat.`);
    this.currentStat.queued++;
    this.queueHook();
  }

  private resetCurrentStat() {
    this.currentStat = {
      cpu: 0,
      date: Date.now(),
      error: 0,
      memory: 0,
      queued: 0,
      rejected: 0,
      successful: 0,
      timedout: 0,
    };
  }

  private async recordMetrics() {
    const { cpuUsage, memoryUsage } = await this.resourceMonitor.getMachineStats();

    this.stats.push(Object.assign({}, {
      ...this.currentStat,
      cpu: cpuUsage,
      date: Date.now(),
      memory: memoryUsage,
    }));

    this.resetCurrentStat();

    if (this.stats.length > maxStats) {
      this.stats.shift();
    }

    if (cpuUsage >= this.config.maxCPU || memoryUsage >= this.config.maxMemory) {
      debug(`Health checks have failed, calling failure webhook: CPU: ${cpuUsage}% Memory: ${memoryUsage}%`);
      this.healthFailureHook();
    }

    if (this.config.metricsJSONPath) {
      writeFile(this.config.metricsJSONPath, JSON.stringify(this.stats))
        .then(() => debug(`Successfully wrote metrics to ${this.config.metricsJSONPath}`))
        .catch((error) => debug(`Couldn't save metrics to ${this.config.metricsJSONPath}. Error: "${error.message}"`));
    }
  }
}
