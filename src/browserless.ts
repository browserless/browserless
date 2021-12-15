import http, { ServerResponse } from 'http';

import { Socket } from 'net';

import url from 'url';

import cookie from 'cookie';
import cors from 'cors';
import express from 'express';
import promBundle from 'express-prom-bundle';
import httpProxy from 'http-proxy';
import _ from 'lodash';

import client from 'prom-client';
import request from 'request';

import { getBrowsersRunning } from './chrome-helper';
import { Features } from './features';
import { getMachineStats, overloaded } from './hardware-monitoring';
import { afterRequest, beforeRequest, externalRoutes } from './hooks';

import { PuppeteerProvider } from './puppeteer-provider';
import { Queue } from './queue';
import { getRoutes } from './routes';
import { clearTimers } from './scheduler';

import {
  IBrowserlessOptions,
  IBrowserlessStats,
  IDone,
  IJob,
  IWebdriverStartHTTP,
} from './types.d';
import * as util from './utils';
import { WebDriver } from './webdriver-provider';

const debug = util.getDebug('server');

const twentyFourHours = 1000 * 60 * 60 * 24;
const thirtyMinutes = 30 * 60 * 1000;
const fiveMinutes = 5 * 60 * 1000;
const maxStats = 12 * 24 * 7; // 7 days @ 5-min intervals

export class BrowserlessServer {
  public currentStat: IBrowserlessStats;
  public readonly capacityFullHook: () => void;
  public readonly queueHook: () => void;
  public readonly timeoutHook: () => void;
  public readonly healthFailureHook: () => void;
  public readonly sessionCheckFailHook: () => void;
  public readonly errorHook: (message: string) => void;
  public readonly queue: Queue;
  public proxy: httpProxy;

  private config: IBrowserlessOptions;
  private stats: IBrowserlessStats[];
  private httpServer: http.Server;
  private puppeteerProvider: PuppeteerProvider;
  private webdriver: WebDriver;
  private metricsInterval: NodeJS.Timeout;
  private workspaceDir: IBrowserlessOptions['workspaceDir'];
  private singleRun: IBrowserlessOptions['singleRun'];
  private enableAPIGet: IBrowserlessOptions['enableAPIGet'];

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
      ...(this.config.connectionTimeout !== -1 && {
        timeout: this.config.connectionTimeout,
      }),
    });

    this.puppeteerProvider = new PuppeteerProvider(opts, this, this.queue);
    this.webdriver = new WebDriver(this.queue);
    this.enableAPIGet = opts.enableAPIGet;
    this.singleRun = opts.singleRun;
    this.workspaceDir = opts.workspaceDir;
    this.stats = [];

    this.proxy = httpProxy.createProxyServer();
    this.proxy.on('error', (err: Error, _req, res) => {
      if (res instanceof ServerResponse) {
        res.writeHead && res.writeHead(500, { 'Content-Type': 'text/plain' });

        debug(`Issue communicating with Chrome: "${err.message}"`);
        res.end(`Issue communicating with Chrome`);
      }
    });

    function restartOnFailure() {
      if (opts.exitOnHealthFailure) {
        process.exit(1);
      }
    }

    this.queueHook = opts.queuedAlertURL
      ? _.debounce(
          () => {
            debug(
              `Calling web-hook for queued session(s): ${opts.queuedAlertURL}`,
            );
            request(opts.queuedAlertURL as string, _.noop);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : _.noop;

    this.capacityFullHook = opts.rejectAlertURL
      ? _.debounce(
          () => {
            debug(
              `Calling web-hook for rejected session(s): ${opts.rejectAlertURL}`,
            );
            request(opts.rejectAlertURL as string, _.noop);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : _.noop;

    this.timeoutHook = opts.timeoutAlertURL
      ? _.debounce(
          () => {
            debug(
              `Calling web-hook for timed-out session(s): ${opts.timeoutAlertURL}`,
            );
            request(opts.timeoutAlertURL as string, _.noop);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : _.noop;

    this.errorHook = opts.errorAlertURL
      ? _.debounce(
          (message) => {
            debug(`Calling web-hook for errors(s): ${opts.errorAlertURL}`);
            const parsed = url.parse(opts.errorAlertURL as string, true);
            parsed.query.error = message;
            parsed.search = null;
            const finalUrl = url.format(parsed);
            request(finalUrl, _.noop);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : _.noop;

    this.healthFailureHook = opts.healthFailureURL
      ? _.debounce(
          () => {
            debug(
              `Calling web-hook for health-failure: ${opts.healthFailureURL}`,
            );
            request(opts.healthFailureURL as string, restartOnFailure);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : restartOnFailure;

    this.sessionCheckFailHook = opts.sessionCheckFailURL
      ? _.debounce(
          () => {
            debug(
              `Calling web-hook for session-check-failure: ${opts.sessionCheckFailURL}`,
            );
            request(opts.sessionCheckFailURL as string, _.noop);
          },
          thirtyMinutes,
          debounceOpts,
        )
      : _.noop;

    this.queue.on('success', this.onSessionSuccess.bind(this));
    this.queue.on('error', this.onSessionFail.bind(this));
    this.queue.on('timeout', this.onTimedOut.bind(this));
    this.queue.on('queued', this.onQueued.bind(this));
    this.queue.on('end', this.onQueueDrained.bind(this));
    this.queue.on('start', this.onStart.bind(this));

    this.resetCurrentStat();

    // If we're saving metrics, load any potential prior-state
    if (opts.metricsJSONPath) {
      try {
        const priorMetrics = require(opts.metricsJSONPath);
        this.stats = priorMetrics;
      } catch (err) {
        debug(
          `Couldn't load metrics at path ${opts.metricsJSONPath}, setting to empty.`,
        );
      }
    }

    this.metricsInterval = global.setInterval(
      this.recordMetrics.bind(this),
      fiveMinutes,
    );

    const boundClose = this.close.bind(this);

    process.on('SIGTERM', boundClose);
    process.on('SIGINT', boundClose);

    debug(require('./config'), `Final configuration`);
  }

  public async getMetrics() {
    const { cpu, memory } = await getMachineStats();

    return [
      ...this.stats,
      {
        ...this.currentStat,
        ...this.calculateStats(this.currentStat),
        date: Date.now(),
        cpu,
        memory,
      },
    ];
  }

  public getConfig() {
    return this.config;
  }

  public async getPressure() {
    const {
      memoryOverloaded,
      cpuOverloaded,
      cpuInt: cpu,
      memoryInt: memory,
    } = await overloaded();

    const queueLength = this.queue.length;
    const openSessions = getBrowsersRunning();
    const concurrencyMet = queueLength >= openSessions;

    const queueFull = !(queueLength < this.config.maxQueueLength);

    const isAvailable = !queueFull && !cpuOverloaded && !memoryOverloaded;

    const reason = queueFull
      ? 'full'
      : cpuOverloaded
      ? 'cpu'
      : memoryOverloaded
      ? 'memory'
      : '';

    const message = queueFull
      ? 'Concurrency and queue are full'
      : cpuOverloaded
      ? 'CPU is over the configured maximum for cpu percent'
      : memoryOverloaded
      ? 'Memory is over the configured maximum for memory percent'
      : '';

    return {
      date: Date.now(),
      reason,
      message,
      isAvailable,
      queued: concurrencyMet ? queueLength - openSessions : 0,
      recentlyRejected: this.currentStat.rejected,
      running: openSessions,
      maxConcurrent: this.queue.concurrencySize,
      maxQueued: this.config.maxQueueLength - this.config.maxConcurrentSessions,
      cpu,
      memory,
    };
  }

  public async startServer(): Promise<any> {
    await this.puppeteerProvider.start();

    return new Promise(async (r) => {
      // Make sure we have http server setup with some headroom
      // for timeouts (so we can respond with appropriate http codes)
      const httpTimeout =
        this.config.connectionTimeout === -1
          ? twentyFourHours
          : this.config.connectionTimeout + 100;
      const app = express();

      if (!this.config.disabledFeatures.includes(Features.PROMETHEUS)) {
        client.register.clear();
        const metricsMiddleware = promBundle({
          includeMethod: true,
          includePath: true,
          includeStatusCode: true,
          includeUp: false,
          metricsPath: '/prometheus(\\?.+)?',
        });
        app.use(metricsMiddleware);
        client.collectDefaultMetrics();
      }

      const routes = getRoutes({
        disabledFeatures: this.config.disabledFeatures,
        getConfig: this.getConfig.bind(this),
        getMetrics: this.getMetrics.bind(this),
        getPressure: this.getPressure.bind(this),
        puppeteerProvider: this.puppeteerProvider,
        workspaceDir: this.workspaceDir,
        enableAPIGet: this.enableAPIGet,
      });

      if (this.config.enableCors) {
        app.use(cors());
      }

      if (!this.config.disabledFeatures.includes(Features.DEBUG_VIEWER)) {
        app.use('/devtools', express.static('./devtools'));
        app.use(
          '/',
          express.static('./node_modules/browserless-debugger/static'),
        );
      }

      if (externalRoutes) {
        app.use(externalRoutes);
      }

      app.use(routes);

      return (this.httpServer = http
        .createServer(async (req, res) => {
          const beforeResults = await beforeRequest({ req, res });

          if (!beforeResults) {
            return;
          }

          const reqParsed = util.parseRequest(req);

          // Handle webdriver requests early, which handles it's own auth
          if (util.isWebdriver(req)) {
            return this.handleWebDriver(reqParsed, res);
          }

          if (
            this.config.token &&
            !util.isAuthorized(reqParsed, this.config.token)
          ) {
            res.writeHead &&
              res.writeHead(403, { 'Content-Type': 'text/plain' });
            return res.end('Unauthorized');
          }

          // Handle token auth
          const cookies = cookie.parse(reqParsed.headers.cookie || '');

          if (!cookies[util.tokenCookieName] && this.config.token) {
            const cookieToken = cookie.serialize(
              util.tokenCookieName,
              this.config.token,
              {
                httpOnly: true,
                maxAge: twentyFourHours / 1000,
              },
            );
            res.setHeader('Set-Cookie', cookieToken);
          }

          return app(req, res);
        })
        .on(
          'upgrade',
          util.asyncWsHandler(
            async (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
              const beforeResults = await beforeRequest({
                req,
                socket,
                head,
              });

              socket.on('error', (error) => {
                debug(`Error with inbound socket ${error}\n${error.stack}`);
              });

              socket.once('close', () => socket.removeAllListeners());

              if (!beforeResults) {
                return;
              }

              const reqParsed = util.parseRequest(req);

              if (
                this.config.token &&
                !util.isAuthorized(reqParsed, this.config.token)
              ) {
                return this.rejectSocket({
                  header: `HTTP/1.1 403 Forbidden`,
                  message: `Forbidden`,
                  req: reqParsed,
                  socket,
                });
              }

              return this.puppeteerProvider.runWebSocket(
                reqParsed,
                socket,
                head,
              );
            },
          ),
        )
        .setTimeout(httpTimeout)
        .listen(this.config.port, this.config.host, undefined, () => r(null)));
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
        resolve(null);
      }),
      this.puppeteerProvider.kill(),
      this.webdriver.kill(),
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

  public rejectReq({
    req,
    res,
    code,
    message,
    metricType,
    hook,
  }: {
    req: express.Request;
    res: express.Response;
    code: number;
    message: string;
    metricType?: keyof IBrowserlessStats;
    hook?: () => any;
  }) {
    debug(`${req.url}: ${message}`);
    res.status(code).send(message);

    if (metricType) {
      this.currentStat[metricType]++;
    }

    if (hook) {
      hook();
    }
  }

  public rejectSocket({
    req,
    socket,
    header,
    message,
    metricType,
    hook,
  }: {
    req: http.IncomingMessage;
    socket: Socket;
    header: string;
    message: string;
    metricType?: keyof IBrowserlessStats;
    hook?: () => any;
  }) {
    if (this.config.socketBehavior === 'http') {
      debug(
        `${req.url}: ${message}. Behavior of "http" set, writing response and closing.`,
      );
      const httpResponse = util.dedent(`${header}
        Content-Type: text/plain; charset=UTF-8
        Content-Encoding: UTF-8
        Accept-Ranges: bytes
        Connection: keep-alive

        ${message}`);

      socket.write(httpResponse);
      socket.end();
    } else {
      debug(
        `${req.url}: ${message}. Behavior of "close" set, destroying connection without response.`,
      );
      socket.destroy();
    }

    if (hook) {
      hook();
    }

    if (metricType) {
      this.currentStat[metricType]++;
    }
  }

  private calculateStats(stat: IBrowserlessStats) {
    return {
      maxTime: _.max(stat.sessionTimes) || 0,
      minTime: _.min(stat.sessionTimes) || 0,
      meanTime: _.mean(stat.sessionTimes) || 0,
      totalTime: _.sum(stat.sessionTimes),
    };
  }

  private async handleWebDriver(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const isStarting = util.isWebdriverStart(req);
    const isClosing = util.isWebdriverClose(req);

    if (isStarting) {
      const ret = req as IWebdriverStartHTTP;
      const { body, params } = await util.normalizeWebdriverStart(req);

      if (!body) {
        res.writeHead && res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Bad Request');
      }

      if (this.config.token && this.config.token !== params.token) {
        res.writeHead && res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('Unauthorized');
      }

      ret.body = body;

      return this.webdriver.start(ret, res, params, this.currentStat);
    }

    if (isClosing) {
      return this.webdriver.closeSession(req, res);
    }

    return this.webdriver.proxySession(req, res);
  }

  private onStart() {
    debug(`Starting new job`);
    const currentlyRunning =
      this.queue.length >= this.queue.concurrencySize
        ? this.queue.concurrencySize
        : this.queue.length;

    this.currentStat.maxConcurrent =
      currentlyRunning > this.currentStat.maxConcurrent
        ? currentlyRunning
        : this.currentStat.maxConcurrent;
  }

  private onSessionSuccess(_res: express.Response, job: IJob) {
    debug(`${job.id}: Recording successful stat and cleaning up.`);
    this.currentStat.successful++;
    this.currentStat.sessionTimes.push(Date.now() - job.start);
    job.close && job.close();
    afterRequest({
      req: job.req,
      start: job.start,
      status: 'successful',
    });
  }

  private onSessionFail(error: Error, job: IJob) {
    debug(`${job.id}: Recording failed stat, cleaning up: "${error.message}"`);
    this.currentStat.error++;
    this.currentStat.sessionTimes.push(Date.now() - job.start);
    this.errorHook(error.message);
    job.close && job.close();
    afterRequest({
      req: job.req,
      start: job.start,
      status: 'error',
    });
  }

  private onTimedOut(next: IDone, job: IJob) {
    debug(`${job.id}: Recording timedout stat.`);
    this.currentStat.timedout++;
    this.currentStat.sessionTimes.push(Date.now() - job.start);
    this.timeoutHook();
    job.onTimeout && job.onTimeout();
    job.close && job.close();
    afterRequest({
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
      global.setTimeout(process.exit, 1000);
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
      unhealthy: 0,
      successful: 0,
      timedout: 0,
      totalTime: 0,
      maxTime: 0,
      minTime: 0,
      meanTime: 0,
      maxConcurrent: 0,
      sessionTimes: [],
    };
  }

  private async recordMetrics() {
    const { cpu, memory } = await getMachineStats();
    const priorMetrics = this.stats[this.stats.length - 1];
    const aggregatedStats = {
      ...this.currentStat,
      ...this.calculateStats(this.currentStat),
      cpu,
      memory,
    };

    this.stats.push(Object.assign({}, aggregatedStats));

    this.resetCurrentStat();

    if (this.stats.length > maxStats) {
      this.stats.shift();
    }

    const mapToInt = (v?: number | null) => (v ? Math.round(v * 100) : v);
    const mapToDisplay = (v?: number | null) => (v ? `${v}%` : v);

    const cpuStats = [cpu, priorMetrics?.cpu].map(mapToInt);
    const memStats = [memory, priorMetrics?.memory].map(mapToInt);

    debug(
      `Health check stats: CPU ${cpuStats.map(
        mapToDisplay,
      )} MEM: ${memStats.map(mapToDisplay)}`,
    );

    debug(
      `Current period usage: ${JSON.stringify({
        date: aggregatedStats.date,
        error: aggregatedStats.error,
        rejected: aggregatedStats.rejected,
        successful: aggregatedStats.successful,
        timedout: aggregatedStats.timedout,
        totalTime: aggregatedStats.totalTime,
        maxTime: aggregatedStats.maxTime,
        minTime: aggregatedStats.minTime,
        meanTime: aggregatedStats.meanTime,
        maxConcurrent: aggregatedStats.maxConcurrent,
      })}`,
    );

    const badCPU = cpuStats.every((c) => c && c >= this.config.maxCPU);
    const badMem = memStats.every((m) => m && m >= this.config.maxMemory);

    if (badCPU || badMem) {
      debug(`Health checks have failed, calling failure webhook`);
      this.healthFailureHook();
    }

    if (this.config.metricsJSONPath) {
      util
        .writeFile(this.config.metricsJSONPath, JSON.stringify(this.stats))
        .then(() =>
          debug(`Successfully wrote metrics to ${this.config.metricsJSONPath}`),
        )
        .catch((error) =>
          debug(
            `Couldn't save metrics to ${this.config.metricsJSONPath}. Error: "${error.message}"`,
          ),
        );
    }
  }
}
