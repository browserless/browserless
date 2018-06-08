import * as _ from 'lodash';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as multer from 'multer';
import { NodeVM } from 'vm2';
import * as puppeteer from 'puppeteer';
import { setInterval } from 'timers';
import * as bodyParser from 'body-parser';

import {
  screenshot as screenshotSchema,
  content as contentSchema,
  pdf as pdfSchema,
  fn as fnSchema,
} from './schemas';

import {
  IResourceLoad,
  debug,
  asyncMiddleware,
  generateChromeTarget,
  getMachineStats,
  bodyValidation,
} from './util';

const request = require('request');
const queue = require('queue');

const fnLoader = (fnName: string) =>
  fs.readFileSync(path.join(__dirname, '..', 'functions', `${fnName}.js`), 'utf8');

// Browserless fn's
const screenshot = fnLoader('screenshot');
const content = fnLoader('content');
const pdf = fnLoader('pdf');

const version = require('../version.json');
const protocol = require('../protocol.json');
const hints = require('../hints.json');

const thiryMinutes = 30 * 60 * 1000;
const fiveMinute = 5 * 60 * 1000;
const halfSecond = 500;
const maxStats = 12 * 24 * 7; // 7 days @ 5-min intervals

export interface IOptions {
  connectionTimeout: number;
  port: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  demoMode: boolean;
  enableDebugger: boolean;
  maxMemory: number;
  maxCPU: number;
  autoQueue: boolean;
  token: string | null;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
  healthFailureURL: string | null;
}

interface IStats {
  date: number | null;
  successful: number;
  error: number;
  queued: number;
  rejected: number;
  memory: number;
  cpu: number;
  timedout: number;
};

interface IFileRequest extends express.Request {
  file: any
}

export class Chrome {
  public port: number;
  public maxConcurrentSessions: number;
  public maxQueueLength: number;
  public connectionTimeout: number;
  public token: string | null;
  public maxMemory: number;
  public maxCPU: number;
  public autoQueue: boolean;

  private proxy: any;
  private prebootChrome: boolean;
  private demoMode: boolean;
  private enableDebugger: boolean;
  private chromeSwarm: Promise<puppeteer.Browser>[];
  private queue: any;
  private server: any;
  private debuggerScripts: any;

  readonly rejectHook: Function;
  readonly queueHook: Function;
  readonly timeoutHook: Function;
  readonly healthFailureHook: Function;

  private stats: IStats[];
  private currentStat: IStats;
  private currentMachineStats: IResourceLoad;

  constructor(opts: IOptions) {
    this.port = opts.port;
    this.maxConcurrentSessions = opts.maxConcurrentSessions;
    this.maxQueueLength = opts.maxQueueLength + opts.maxConcurrentSessions;
    this.connectionTimeout = opts.connectionTimeout;
    this.prebootChrome = opts.prebootChrome;
    this.demoMode = opts.demoMode;
    this.token = opts.token;
    this.enableDebugger = opts.enableDebugger;
    this.maxCPU = opts.maxCPU;
    this.maxMemory = opts.maxMemory;
    this.autoQueue = opts.autoQueue;

    this.chromeSwarm = [];
    this.stats = [];
    this.debuggerScripts = new Map();
    this.currentMachineStats = {
      cpuUsage: 0,
      memoryUsage: 0,
    };

    this.proxy = new httpProxy.createProxyServer();
    this.proxy.on('error', function (err, _req, res) {
      if (res.writeHead) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }

      if (res.close) {
        res.close();
      }

      debug(`Issue communicating with Chrome: "${err.message}"`);
      res.end(`Issue communicating with Chrome`);
    });

    this.queue = queue({
      concurrency: this.maxConcurrentSessions,
      timeout: this.connectionTimeout,
      autostart: true
    });

    this.queue.on('success', this.onSessionComplete.bind(this));
    this.queue.on('error', this.onSessionFail.bind(this));
    this.queue.on('timeout', this.onTimedOut.bind(this));

    this.queueHook = opts.queuedAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for queued session(s): ${opts.queuedAlertURL}`);
        request(opts.queuedAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    this.rejectHook = opts.rejectAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for rejected session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    this.timeoutHook = opts.timeoutAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for timed-out session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    this.healthFailureHook = opts.healthFailureURL ?
      _.debounce(() => {
        debug(`Calling webhook for health-failure: ${opts.healthFailureURL}`);
        request(opts.healthFailureURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    debug({
      port: this.port,
      token: this.token,
      connectionTimeout: this.connectionTimeout,
      maxQueueLength: this.maxQueueLength,
      maxConcurrentSessions: this.maxConcurrentSessions,
      rejectAlertURL: opts.rejectAlertURL,
      timeoutAlertURL: opts.timeoutAlertURL,
      queuedAlertURL: opts.queuedAlertURL,
      prebootChrome: this.prebootChrome,
      demoMode: this.demoMode,
      maxMemory: this.maxMemory,
      maxCPU: this.maxCPU,
      autoQueue: this.autoQueue,
      enableDebugger: this.enableDebugger,
    }, `Final Options`);

    if (this.prebootChrome) {
      for (let i = 0; i < this.maxConcurrentSessions; i++) {
        this.chromeSwarm.push(this.launchChrome());
      }
    }

    this.resetCurrentStat();

    setInterval(this.recordMachineStats.bind(this), halfSecond);
    setInterval(this.recordMetrics.bind(this), fiveMinute);
  }

  private onTimedOut(next, job) {
    debug(`Timeout hit for session, closing. ${this.queue.length} in queue.`);
    job.close('HTTP/1.1 408 Request has timed out\r\n');
    this.currentStat.timedout = this.currentStat.timedout + 1;
    this.timeoutHook();
    this.onSessionComplete();
    next();
  }

  private onQueued(req) {
    debug(`${req.url}: Concurrency limit hit, queueing`);
    this.currentStat.queued = this.currentStat.queued + 1;
    this.queueHook();
  }

  private rejectSocket(req, socket, message) {
    debug(`${req.url}: ${message}`);
    this.closeSocket(socket, `${message}\r\n`);
    this.currentStat.rejected = this.currentStat.rejected + 1;
    this.rejectHook();
  }

  private rejectReq(req, res, message) {
    debug(`${req.url}: ${message}`);
    res.status(429).send(message);
    this.currentStat.rejected = this.currentStat.rejected + 1;
    this.rejectHook();
  }

  private resetCurrentStat() {
    this.currentStat = {
      rejected: 0,
      queued: 0,
      successful: 0,
      error: 0,
      timedout: 0,
      memory: 0,
      cpu: 0,
      date: null,
    };
  }

  private async recordMachineStats() {
    this.currentMachineStats = await getMachineStats();
  }

  private async recordMetrics() {
    const { cpuUsage, memoryUsage } = await getMachineStats();
    debug(`Logging metrics for the current period: ${this.stats.length}`);
    this.stats.push(Object.assign({}, {
      ...this.currentStat,
      cpu: cpuUsage,
      memory: memoryUsage,
      date: Date.now(),
    }));

    this.resetCurrentStat();

    if (this.stats.length > maxStats) {
      this.stats.shift();
    }

    if (cpuUsage >= this.maxCPU || memoryUsage >= this.maxMemory) {
      debug(`Health checks have failed, calling failure webhook: CPU: ${cpuUsage}% Memory: ${memoryUsage}%`);
      this.healthFailureHook();
    }
  }

  private addToChromeSwarm() {
    if (this.prebootChrome && (this.chromeSwarm.length < this.queue.concurrency)) {
      this.chromeSwarm.push(this.launchChrome());
      debug(`Added Chrome instance to swarm, ${this.chromeSwarm.length} online`);
    }
  }

  private onSessionComplete() {
    this.currentStat.successful = this.currentStat.successful + 1;
    this.addToChromeSwarm();
  }

  private onSessionFail() {
    this.currentStat.error = this.currentStat.error + 1;
    this.addToChromeSwarm();
  }

  private closeSocket(socket: any, message: string) {
    debug(`Closing socket.`);
    if (socket.end) {
      socket.end(message);
    }

    if (socket.destroy) {
      socket.destroy();
    }
  }

  private isMachineConstrained() {
    return (
      this.currentMachineStats.cpuUsage >= this.maxCPU ||
      this.currentMachineStats.memoryUsage >= this.maxMemory
    );
  }

  private async launchChrome(flags:string[] = [], retries:number = 1): Promise<puppeteer.Browser> {
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
          console.error(error, `Issue launching Chrome, retrying ${retries} times.`);
          return this.launchChrome(flags, nextRetries);
        }

        console.error(error, `Issue launching Chrome, retries exhausted.`);
        throw error;
      });
  }

  private async runFunction({ code, context, req, res }) {
    const queueLength = this.queue.length;
    const isMachineStrained = this.isMachineConstrained();

    if (queueLength >= this.maxQueueLength) {
      return this.rejectReq(req, res, `Too Many Requests`);
    }

    if (this.autoQueue && (this.queue.length < this.queue.concurrency)) {
      this.queue.concurrency = isMachineStrained ? this.queue.length : this.maxConcurrentSessions;
    }

    if (queueLength >= this.queue.concurrency) {
      this.onQueued(req);
    }

    const vm = new NodeVM();
    const handler: (any) => Promise<any> = vm.run(code);

    debug(`${req.url}: Inbound function execution: ${JSON.stringify({ code, context })}`);

    const job:any = async () => {
      const browser = await this.launchChrome();
      const page = await browser.newPage();

      job.browser = browser;

      return handler({ page, context })
        .then(({ data, type }) => {
          debug(`${req.url}: Function complete, stopping Chrome`);
          _.attempt(() => browser.close());

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
          _.attempt(() => browser.close());
        });
    };

    job.close = () => {
      if (job.browser) {
        job.browser.close();
      }

      if (!res.headersSent) {
        res.status(408).send('browserless function has timed-out');
      }
    };

    req.on('close', () => {
      if (job.browser) {
        debug(`${req.url}: Request has terminated, stopping Chrome.`);
        job.browser.close();
      }
    });

    this.queue.push(job);
  }

  public async startServer(): Promise<any> {
    const app = express();

    app.use(bodyParser.json({ limit: '1mb' }));

    if (this.enableDebugger) {
      const upload = multer();

      app.use('/', express.static('./debugger'));
      app.post('/execute', upload.single('file'), async (req : IFileRequest, res) => {
        const targetId = generateChromeTarget();
        const userScript = req.file.buffer.toString().replace('debugger', 'await page.evaluate(() => { debugger; })');

        // Backwards compatability (remove after a few versions)
        const code = userScript.includes('module.exports') ?
          userScript :
          `module.exports = async ({ page, context: {} }) => {
            try {
              ${userScript}
            } catch (error) {
              console.error('Unhandled Error:', error.message, error.stack);
            }
          }`;

        debug(`/execute: Script uploaded\n${code}`);

        this.debuggerScripts.set(targetId, code);

        res.json({
          targetId,
          debuggerVersion: version['Debugger-Version']
        });
      });
    }

    if (this.token) {
      app.use((req, res, next) => {
        if (this.token && req.query.token !== this.token) {
          return res.sendStatus(403);
        }
        next();
        return;
      });
    }

    app.get('/introspection', (_req, res) => res.json(hints));
    app.get('/json/version', (_req, res) => res.json(version));
    app.get('/json/protocol', (_req, res) => res.json(protocol));
    app.get('/metrics', (_req, res) => res.json([...this.stats, this.currentStat]));

    app.get('/config', (_req, res) => res.json({
      timeout: this.connectionTimeout,
      concurrent: this.maxConcurrentSessions,
      queue: this.maxQueueLength - this.maxConcurrentSessions,
      preboot: this.prebootChrome,
    }));

    app.get('/pressure', (_req, res) => {
      const queueLength = this.queue.length;
      const concurrencyMet = queueLength >= this.queue.concurrency;

      return res.json({
        pressure: {
          date: Date.now(),
          running: concurrencyMet ? this.queue.concurrency : queueLength,
          queued: concurrencyMet ? queueLength - this.queue.concurrency : 0,
          isAvailable: queueLength < this.maxQueueLength,
          recentlyRejected: this.currentStat.rejected,
        }
      });
    });

    // function rout for executing pupeteer scripts, accepts a JSON body with
    // code and context
    app.post('/function', bodyValidation(fnSchema), asyncMiddleware(async (req, res) => {
      const { code, context } = req.body;

      return this.runFunction({ code, context, req, res });
    }));

    // Helper route for capturing screenshots, accepts a POST body containing a URL and
    // puppeteer's screenshot options (see the schema in schemas.ts);
    app.post('/screenshot', bodyValidation(screenshotSchema), asyncMiddleware(async(req, res) => 
      this.runFunction({
        code: screenshot,
        context: req.body,
        req,
        res,
      })
    ));

    // Helper route for capturing content body, accepts a POST body containing a URL 
    // (see the schema in schemas.ts);
    app.post('/content', bodyValidation(contentSchema), asyncMiddleware(async(req, res) => 
      this.runFunction({
        code: content,
        context: req.body,
        req,
        res,
      })
    ))

    // Helper route for capturing screenshots, accepts a POST body containing a URL and
    // puppeteer's screenshot options (see the schema in schemas.ts);
    app.post('/pdf', bodyValidation(pdfSchema), asyncMiddleware(async (req, res) => 
      this.runFunction({
        code: pdf,
        context: req.body,
        req,
        res
      })
    ))

    app.get('/json*', asyncMiddleware(async (req, res) => {
      const targetId = generateChromeTarget();
      const baseUrl = req.get('host');
      const protocol = req.protocol.includes('s') ? 'wss': 'ws';

      debug(`${req.url}: JSON protocol request.`);

      res.json([{
        targetId,
        description: '',
        devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
        title: 'about:blank',
        type: 'page',
        url: 'about:blank',
        webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`
      }]);
    }));

    return this.server = http
      .createServer(app)
      .on('upgrade', asyncMiddleware(async(req, socket, head) => {
        const parsedUrl = url.parse(req.url, true);
        const route = parsedUrl.pathname || '/';
        const queueLength = this.queue.length;
        const isMachineStrained = this.isMachineConstrained();

        debug(`${req.url}: Inbound WebSocket request. ${this.queue.length} in queue.`);

        if (this.demoMode && !this.debuggerScripts.has(route)) {
          return this.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
        }

        if (this.token && parsedUrl.query.token !== this.token) {
          return this.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
        }

        if (queueLength >= this.maxQueueLength) {
          return this.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`);
        }

        if (this.autoQueue && (this.queue.length < this.queue.concurrency)) {
          this.queue.concurrency = isMachineStrained ? this.queue.length : this.maxConcurrentSessions;
        }

        if (queueLength >= this.queue.concurrency) {
          this.onQueued(req);
        }

        const job:any = (done: () => {}) => {
          const flags = _.chain(parsedUrl.query)
            .pickBy((_value, param) => _.startsWith(param, '--'))
            .map((value, key) => `${key}${value ? `=${value}` : ''}`)
            .value();

          const canUseChromeSwarm = !flags.length && !!this.chromeSwarm.length;
          const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(flags);

          debug(`${req.url}: WebSocket upgrade.`);

          (launchPromise || this.launchChrome())
            .then(async (browser) => {
              const browserWsEndpoint = browser.wsEndpoint();

              debug(`${req.url}: Chrome Launched.`);

              socket.on('close', () => {
                debug(`${req.url}: Session closed, stopping Chrome. ${this.queue.length} now in queue`);
                browser.close();
                done();
              });

              if (this.debuggerScripts.has(route)) {
                debug(`${req.url}: Executing prior-uploaded script.`);

                const page:any = await browser.newPage();
                const port = url.parse(browserWsEndpoint).port;
                const pageLocation = `/devtools/page/${page._target._targetId}`;
                const code = this.debuggerScripts.get(route);
                this.debuggerScripts.delete(route);

                const sandbox = {
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

                const vm = new NodeVM({ sandbox });
                const handler = vm.run(code);

                handler({ page, context: {} });
                req.url = pageLocation;
                return `ws://127.0.0.1:${port}`;
              }

              if (!route.includes('/devtools/page')) {
                debug(`${req.url}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`);
                req.url = route;

                return browserWsEndpoint;
              } else {
                const page:any = await browser.newPage();
                const port = url.parse(browserWsEndpoint).port;
                const pageLocation = `/devtools/page/${page._target._targetId}`;
                req.url = pageLocation;

                return `ws://127.0.0.1:${port}`;
              }
            })
            .then((target) => this.proxy.ws(req, socket, head, { target }))
            .catch((error) => {
              console.error(error, `Issue launching Chrome or proxying traffic, failing request`);
              return this.rejectSocket(req, socket, `HTTP/1.1 500`);
            });
        };

        job.close = (message: string) => this.closeSocket(socket, message);

        this.queue.push(job);
      }))
      .listen(this.port);
  }

  public async close() {
    this.server.close();
    this.proxy.close();
  }
}
