import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as fs from 'fs';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as _ from 'lodash';
import * as path from 'path';
import { setInterval } from 'timers';

import {
  asyncMiddleware,
  bodyValidation,
  generateChromeTarget,
  getDebug,
  writeFile,
} from './utils';

import {
  content as contentSchema,
  fn as fnSchema,
  pdf as pdfSchema,
  screenshot as screenshotSchema,
} from './schemas';

import { ChromeService } from './chrome-service';
import { ResourceMonitor } from './hardware-monitoring';
import { IBrowserlessOptions } from './models/options.interface';

const debug = getDebug('server');

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
  public proxy: any;

  private config: IBrowserlessOptions;
  private stats: IBrowserlessStats[];
  private server: any;
  private readonly resourceMonitor: ResourceMonitor;
  private chromeService: ChromeService;

  constructor(opts: IBrowserlessOptions) {
    // The backing queue doesn't let you set a max limitation
    // on length, so we add concurrent sessions + queue length
    // to determine the `queue` array's max length
    this.config = opts;
    this.resourceMonitor = new ResourceMonitor(this.config.maxCPU, this.config.maxMemory);
    this.chromeService = new ChromeService(opts, this);
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

    // If we're saving metrics, load any potential prior-state
    if (opts.metricsJSONPath) {
      try {
        const priorMetrics = require(opts.metricsJSONPath);
        this.stats = priorMetrics;
      } catch (err) {
        debug(`Couldn't load metrics at path ${opts.metricsJSONPath}, setting to empty.`);
      }
    }

    setInterval(this.recordMetrics.bind(this), fiveMinutes);
  }

  public async startServer(): Promise<any> {
    await this.chromeService.start();

    return new Promise(async (resolve) => {
      const app = express();

      app.use(bodyParser.json({ limit: '5mb' }));

      if (this.config.enableCors) {
        app.use(cors());
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
      app.get('/config', (_req, res) => res.json(this.config));

      app.get('/pressure', (_req, res) => {
        const queueLength = this.chromeService.queueSize;
        const queueConcurrency = this.chromeService.concurrencySize;
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
        const { code, context, detached } = req.body;

        return this.chromeService.runHTTP({ code, context, req, res, detached });
      }));

      // Helper route for capturing screenshots, accepts a POST body containing a URL and
      // puppeteer's screenshot options (see the schema in schemas.ts);
      app.post('/screenshot', bodyValidation(screenshotSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runHTTP({
          code: screenshot,
          context: req.body,
          req,
          res,
        }),
      ));

      // Helper route for capturing content body, accepts a POST body containing a URL
      // (see the schema in schemas.ts);
      app.post('/content', bodyValidation(contentSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runHTTP({
          code: content,
          context: req.body,
          req,
          res,
        }),
      ));

      // Helper route for capturing screenshots, accepts a POST body containing a URL and
      // puppeteer's screenshot options (see the schema in schemas.ts);
      app.post('/pdf', bodyValidation(pdfSchema), asyncMiddleware(async (req, res) =>
        this.chromeService.runHTTP({
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
        .on('upgrade', asyncMiddleware(this.chromeService.runWebSocket.bind(this.chromeService)))
        .listen(this.config.port, this.config.host, resolve);
    });
  }

  public async close() {
    return Promise.all([
      new Promise((resolve) => {
        this.server.close(resolve);
        this.server = null;
      }),
      new Promise((resolve) => {
        this.proxy.close();
        this.proxy = null;
        resolve();
      }),
      this.chromeService.close(),
    ]);
  }

  public rejectReq(req, res, code, message) {
    debug(`${req.url}: ${message}`);
    res.status(code).send(message);
    this.currentStat.rejected++;
    this.rejectHook();
  }

  public rejectSocket(req, socket, message) {
    debug(`${req.url}: ${message}`);
    socket.end(message);
    this.currentStat.rejected++;
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
