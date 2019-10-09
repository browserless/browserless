import * as cookie from 'cookie';
import * as cors from 'cors';
import * as express from 'express';
import * as promBundle from 'express-prom-bundle';
import * as fs from 'fs';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as _ from 'lodash';
import { Socket } from 'net';
import * as path from 'path';
import * as client from 'prom-client';
import request = require('request');
import * as url from 'url';

import { Feature } from './features';
import * as util from './utils';

import { ResourceMonitor } from './hardware-monitoring';
import { IBrowserlessOptions } from './models/options.interface';
import { PuppeteerProvider } from './puppeteer-provider';
import { IDone, IJob, Queue } from './queue';
import { getRoutes } from './routes';
import { clearTimers } from './scheduler';
import { WebDriver } from './webdriver-provider';

const debug = util.getDebug('server');

const twentyFourHours = 1000 * 60 * 60 * 24;
const thirtyMinutes = 30 * 60 * 1000;
const fiveMinutes = 5 * 60 * 1000;
const maxStats = 12 * 24 * 7; // 7 days @ 5-min intervals

const webDriverPath = '/webdriver/session';

const beforeHookPath = path.join(__dirname, '..', 'external', 'before.js');
const afterHookPath = path.join(__dirname, '..', 'external', 'after.js');
const externalRoutesPath = path.join(__dirname, '..', 'external', 'routes.js');

const beforeHook = fs.existsSync(beforeHookPath) ?
  require(beforeHookPath) :
  () => true;

const afterHook = fs.existsSync(afterHookPath) ?
  require(afterHookPath) :
  () => true;

const externalRoutes = fs.existsSync(externalRoutesPath) ?
  require(externalRoutesPath) :
  null;

export interface IWebdriverStartHTTP extends util.IHTTPRequest {
  body: any;
}

export class BrowserlessServer {
  public currentStat: IBrowserlessStats;
  public readonly rejectHook: () => void;
  public readonly queueHook: () => void;
  public readonly timeoutHook: () => void;
  public readonly healthFailureHook: () => void;
  public readonly errorHook: (message: string) => void;
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
  private singleRun: IBrowserlessOptions['singleRun'];

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

    this.resourceMonitor = new ResourceMonitor();
    this.puppeteerProvider = new PuppeteerProvider(opts, this, this.queue);
    this.webdriver = new WebDriver(this.queue);
    this.singleRun = opts.singleRun;
    this.workspaceDir = opts.workspaceDir;
    this.stats = [];

    this.proxy = httpProxy.createProxyServer();
    this.proxy.on('error', (err: Error, _req, res) => {
      res.writeHead && res.writeHead(500, { 'Content-Type': 'text/plain' });

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
        request(opts.queuedAlertURL as string, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.rejectHook = opts.rejectAlertURL ?
      _.debounce(() => {
        debug(`Calling web-hook for rejected session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL as string, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.timeoutHook = opts.timeoutAlertURL ?
      _.debounce(() => {
        debug(`Calling web-hook for timed-out session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL as string, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.errorHook = opts.errorAlertURL ?
      _.debounce((message) => {
        debug(`Calling web-hook for errors(s): ${opts.errorAlertURL}`);
        const parsed = url.parse(opts.errorAlertURL as string, true);
        parsed.query.error = message;
        delete parsed.search;
        const finalUrl = url.format(parsed);
        request(finalUrl, _.noop);
      }, thirtyMinutes, debounceOpts) :
      _.noop;

    this.healthFailureHook = opts.healthFailureURL ?
      _.debounce(() => {
        debug(`Calling web-hook for health-failure: ${opts.healthFailureURL}`);
        request(opts.healthFailureURL as string, restartOnFailure);
      }, thirtyMinutes, debounceOpts) :
      restartOnFailure;

    this.queue.on('success', this.onSessionSuccess.bind(this));
    this.queue.on('error', this.onSessionFail.bind(this));
    this.queue.on('timeout', this.onTimedOut.bind(this));
    this.queue.on('queued', this.onQueued.bind(this));
    this.queue.on('end', this.onQueueDrained.bind(this));

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

    this.metricsInterval = setInterval(this.recordMetrics.bind(this), fiveMinutes);

    const boundClose = this.close.bind(this);

    process.on('SIGTERM', boundClose);
    process.on('SIGINT', boundClose);

    debug(require('./config'), `Final configuration`);
  }

  public async getMetrics() {
    const { cpu, memory } = await this.resourceMonitor.getMachineStats();

    return [...this.stats, {
      ...this.currentStat,
      cpu,
      date: Date.now(),
      memory,
    }];
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

      if (!this.config.disabledFeatures.includes(Feature.PROMETHEUS)) {
        client.register.clear();
        const metricsMiddleware = promBundle({
          includeMethod: true,
          includePath: true,
          includeStatusCode: true,
          includeUp: false,
          metricsPath: '/prometheus',
        });
        app.use(metricsMiddleware);
        client.collectDefaultMetrics({ timeout: 5000 });
      }

      const routes = getRoutes({
        disabledFeatures: this.config.disabledFeatures,
        getConfig: this.getConfig.bind(this),
        getMetrics: this.getMetrics.bind(this),
        getPressure: this.getPressure.bind(this),
        puppeteerProvider: this.puppeteerProvider,
        workspaceDir: this.workspaceDir,
      });

      if (this.config.enableCors) {
        app.use(cors());
      }

      if (!this.config.disabledFeatures.includes(Feature.DEBUGGER)) {
        app.use('/', express.static('./debugger'));
      }

      if (externalRoutes) {
        app.use(externalRoutes);
      }

      app.use(routes);

      return this.httpServer = http
        .createServer(async (req, res) => {
          const reqParsed = util.parseRequest(req);
          const beforeResults = await beforeHook({ req: reqParsed, res });

          if (!beforeResults) {
            return res.end();
          }

          // Handle webdriver requests early, which handles it's own auth
          if (reqParsed.url && reqParsed.url.includes(webDriverPath)) {
            return this.handleWebDriver(reqParsed, res);
          }

          if (this.config.token && !util.isAuthorized(reqParsed, this.config.token)) {
            res.writeHead && res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Unauthorized');
          }

          // Handle token auth
          const cookies = cookie.parse(reqParsed.headers.cookie || '');

          if (!cookies[util.tokenCookieName] && this.config.token) {
            const cookieToken = cookie.serialize(util.tokenCookieName, this.config.token, {
              httpOnly: true,
              maxAge: twentyFourHours / 1000,
            });
            res.setHeader('Set-Cookie', cookieToken);
          }

          return app(req, res);
        })
        .on('upgrade', util.asyncWsHandler(async (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
          const reqParsed = util.parseRequest(req);
          const beforeResults = await beforeHook({ req: reqParsed, socket });

          if (!beforeResults) {
            return socket.end();
          }

          if (this.config.token && !util.isAuthorized(reqParsed, this.config.token)) {
            return this.rejectSocket({
              header: `HTTP/1.1 403 Forbidden`,
              message: `Forbidden`,
              recordStat: false,
              req: reqParsed,
              socket,
            });
          }

          return this.puppeteerProvider.runWebSocket(reqParsed, socket, head);
        }))
        .setTimeout(httpTimeout)
        .listen(this.config.port, this.config.host, resolve);
    });
  }

  public async kill() {
    debug(`Kill received, forcefully closing`);

    clearInterval(this.metricsInterval);
    clearTimers();
    process.removeAllListeners();
    this.proxy.removeAllListeners();
    await util.clearBrowserlessDataDirs();

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
    clearTimers();
    process.removeAllListeners();
    this.proxy.removeAllListeners();
    await util.clearBrowserlessDataDirs();

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

  public rejectSocket(
    { req, socket, header, message, recordStat }:
    { req: http.IncomingMessage; socket: Socket; header: string; message: string; recordStat: boolean; },
  ) {
    debug(`${req.url}: ${message}`);

    socket.write([
      header,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Encoding: UTF-8',
      'Accept-Ranges: bytes',
      'Connection: keep-alive',
    ].join('\n') + '\n\n');
    socket.write(message);
    socket.end();

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
      const ret = req as IWebdriverStartHTTP;
      const postBody = await util.normalizeWebdriverStart(req);
      if (!postBody) {
        res.writeHead && res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request');
      }

      if (this.config.token && !util.isWebdriverAuthorized(req, postBody, this.config.token)) {
        res.writeHead && res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Unauthorized');
      }

      ret.body = postBody;

      return this.webdriver.start(ret, res);
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
    this.errorHook(error.message);
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

  private onQueueDrained() {
    debug(`Current workload complete.`);

    if (this.singleRun) {
      debug(`Running in single-run mode, exiting in 1 second`);
      setTimeout(process.exit, 1000);
    }
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
    const { cpu, memory } = await this.resourceMonitor.getMachineStats();

    this.stats.push(Object.assign({}, {
      ...this.currentStat,
      cpu,
      date: Date.now(),
      memory,
    }));

    this.resetCurrentStat();

    if (this.stats.length > maxStats) {
      this.stats.shift();
    }

    if (cpu >= this.config.maxCPU || memory >= this.config.maxMemory) {
      debug(`Health checks have failed, calling failure webhook: CPU: ${cpu}% Memory: ${memory}%`);
      this.healthFailureHook();
    }

    if (this.config.metricsJSONPath) {
      util.writeFile(this.config.metricsJSONPath, JSON.stringify(this.stats))
        .then(() => debug(`Successfully wrote metrics to ${this.config.metricsJSONPath}`))
        .catch((error) => debug(`Couldn't save metrics to ${this.config.metricsJSONPath}. Error: "${error.message}"`));
    }
  }
}
