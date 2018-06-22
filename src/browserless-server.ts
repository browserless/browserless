import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as _ from 'lodash';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { setInterval } from 'timers';
import * as url from 'url';
import { NodeVM } from 'vm2';

import {
  asyncMiddleware,
  bodyValidation,
  debug,
  generateChromeTarget,
} from './utils';

import {
  content as contentSchema,
  fn as fnSchema,
  pdf as pdfSchema,
  screenshot as screenshotSchema,
} from './schemas';

import { ChromeService } from './chrome-service';
import { ResourceMonitor } from './hardware-monitoring';
import { IBrowserlessOptions } from './models/browserless-options.interface';

const request = require('request');
const fnLoader = (fnName: string) => fs.readFileSync(path.join(__dirname, '..', 'functions', `${fnName}.js`), 'utf8');

// Browserless fn's
const screenshot = fnLoader('screenshot');
const content = fnLoader('content');
const pdf = fnLoader('pdf');

const version = require('../version.json');
const protocol = require('../protocol.json');
const hints = require('../hints.json');

const thiryMinutes = 30 * 60 * 1000;
const fiveMinutes = 5 * 60 * 1000;
const maxStats = 12 * 24 * 7; // 7 days @ 5-min intervals

export class BrowserlessServer {
  public currentStat: IBrowserlessStats;
  public readonly rejectHook: () => void;
  public readonly queueHook: () => void;
  public readonly timeoutHook: () => void;
  public readonly healthFailureHook: () => void;

  private config: IBrowserlessOptions;
  private proxy: any;
  private stats: IBrowserlessStats[];
  private server: any;
  private readonly resourceMonitor: ResourceMonitor;
  private chromeService: ChromeService;

  constructor(opts: IBrowserlessOptions) {
    // The backing queue doesn't let you set a max limitation
    // on length, so we add concurrent sessions + queue length
    // to determine the `queue` array's max length
    this.config = {
      ...opts,
      maxQueueLength: opts.maxQueueLength + opts.maxConcurrentSessions,
    };

    this.resourceMonitor = new ResourceMonitor(this.config.maxCPU, this.config.maxMemory);
    this.chromeService = new ChromeService(opts, this, this.resourceMonitor);
    this.stats = [];

    this.proxy = new httpProxy.createProxyServer();
    this.proxy.on('error', (err, _req, res) => {
      if (res.writeHead) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }

      if (res.close) {
        res.close();
      }

      debug(`Issue communicating with Chrome: "${err.message}"`);
      res.end(`Issue communicating with Chrome`);
    });

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

    debug(this.config, `Final Options`);

    this.resetCurrentStat();

    setInterval(this.recordMetrics.bind(this), fiveMinutes);
  }

  public async startServer(): Promise<any> {
    return new Promise((resolve) => {
      const app = express();

      app.use(bodyParser.json({ limit: '1mb' }));

      if (this.config.enableCors) {
        app.use((_, res, next) => {
          res.header('Access-Control-Allow-Origin', '*');
          res.header('Access-Control-Allow-Headers',
            'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With');
          next();
        });
      }

      if (this.config.enableDebugger) {
        app.use('/', express.static('./debugger'));
      }

      if (this.config.token) {
        app.use((req, res, next) => {
          if (this.config.token && req.query.token !== this.config.token) {
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
        concurrent: this.config.maxConcurrentSessions,
        preboot: this.config.prebootChrome,
        queue: this.config.maxQueueLength - this.config.maxConcurrentSessions,
        timeout: this.config.connectionTimeout,
      }));

      app.get('/pressure', (_req, res) => {
        const queueLength = this.chromeService.queueSize;
        const queueConcurrency = this.chromeService.queueConcurrency;
        const concurrencyMet = queueLength >= queueConcurrency;

        return res.json({
          pressure: {
            date: Date.now(),
            isAvailable: queueLength < this.config.maxQueueLength,
            queued: concurrencyMet ? queueLength - queueConcurrency : 0,
            recentlyRejected: this.currentStat.rejected,
            running: concurrencyMet ? queueConcurrency : queueLength,
          },
        });
      });

      // function route for executing puppeteer scripts, accepts a JSON body with
      // code and context
      app.post('/function', bodyValidation(fnSchema), asyncMiddleware(async (req, res) => {
        const { code, context } = req.body;

        return this.chromeService.runFunction({ code, context, req, res });
      }));

      // Helper route for capturing screenshots, accepts a POST body containing a URL and
      // puppeteer's screenshot options (see the schema in schemas.ts);
      app.post('/screenshot', bodyValidation(screenshotSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runFunction({
          code: screenshot,
          context: req.body,
          req,
          res,
        }),
      ));

      // Helper route for capturing content body, accepts a POST body containing a URL
      // (see the schema in schemas.ts);
      app.post('/content', bodyValidation(contentSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runFunction({
          code: content,
          context: req.body,
          req,
          res,
        }),
      ));

      // Helper route for capturing screenshots, accepts a POST body containing a URL and
      // puppeteer's screenshot options (see the schema in schemas.ts);
      app.post('/pdf', bodyValidation(pdfSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runFunction({
          code: pdf,
          context: req.body,
          req,
          res,
        }),
      ));

      app.get('/json*', asyncMiddleware(async (req, res) => {
        const targetId = generateChromeTarget();
        const baseUrl = req.get('host');
        const protocol = req.protocol.includes('s') ? 'wss' : 'ws';

        debug(`${req.url}: JSON protocol request.`);

        res.json([{
          description: '',
          devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
          targetId,
          title: 'about:blank',
          type: 'page',
          url: 'about:blank',
          webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`,
        }]);
      }));

      return this.server = http
        .createServer(app)
        .on('upgrade', asyncMiddleware(async (req, socket, head) => {
          const parsedUrl = url.parse(req.url, true);
          const route = parsedUrl.pathname || '/';
          const queueLength = this.chromeService.queueSize;
          const debugCode = parsedUrl.query.code as string;
          const code = this.parseUserCode(debugCode);

          debug(`${req.url}: Inbound WebSocket request. ${queueLength} in queue.`);

          if (this.config.demoMode && !code) {
            return this.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
          }

          if (this.config.token && parsedUrl.query.token !== this.config.token) {
            return this.rejectSocket(req, socket, `HTTP/1.1 403 Forbidden`);
          }

          if (queueLength >= this.config.maxQueueLength) {
            return this.rejectSocket(req, socket, `HTTP/1.1 429 Too Many Requests`);
          }

          this.chromeService.autoUpdateQueue();

          if (queueLength >= this.chromeService.queueConcurrency) {
            this.chromeService.onQueued(req);
          }

          const job: any = (done: () => {}) => {
            const flags = _.chain(parsedUrl.query)
              .pickBy((_value, param) => _.startsWith(param, '--'))
              .map((value, key) => `${key}${value ? `=${value}` : ''}`)
              .value();

            const launchPromise = this.chromeService.getChrome(flags);
            debug(`${req.url}: WebSocket upgrade.`);

            launchPromise
              .then(async (browser) => {
                const browserWsEndpoint = browser.wsEndpoint();

                debug(`${req.url}: Chrome Launched.`);

                socket.on('close', () => {
                  debug(`${req.url}: Session closed, stopping Chrome. ${this.chromeService.queueSize} now in queue`);
                  browser.close();
                  done();
                });

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
              .then((target) => this.proxy.ws(req, socket, head, { target }))
              .catch((error) => {
                debug(error, `Issue launching Chrome or proxying traffic, failing request`);
                return this.rejectSocket(req, socket, `HTTP/1.1 500`);
              });
          };

          job.close = (message: string) => this.closeSocket(socket, message);

          this.chromeService.addJob(job);
        }))
        .listen(this.config.port, resolve);
    });
  }

  public async close() {
    this.server.close();
    this.proxy.close();
  }

  public rejectReq(req, res, message) {
    debug(`${req.url}: ${message}`);
    res.status(429).send(message);
    this.currentStat.rejected = this.currentStat.rejected + 1;
    this.rejectHook();
  }

  private rejectSocket(req, socket, message) {
    debug(`${req.url}: ${message}`);
    this.closeSocket(socket, `${message}\r\n`);
    this.currentStat.rejected = this.currentStat.rejected + 1;
    this.rejectHook();
  }

  private resetCurrentStat() {
    this.currentStat = {
      cpu: 0,
      date: null,
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
    debug(`Logging metrics for the current period: ${this.stats.length}`);
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
}
