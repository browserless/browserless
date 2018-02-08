import * as _ from 'lodash';
import * as url from 'url';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as multer from 'multer';
import { VM } from 'vm2';
import { launch } from 'puppeteer';

const debug = require('debug')('browserless/chrome');
const request = require('request');
const queue = require('queue');
const version = require('../version.json');
const protocol = require('../protocol.json');

const chromeTarget = () => {
  var text = '';
  var possible = 'ABCDEF0123456789';

  for (var i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return `/devtools/page/${text}`;
};

const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        debug(`ERROR: ${error}`);
        socket.write('HTTP/1.1 429 Too Many Requests\r\n');
        socket.end();
      });
  }
};

const thiryMinutes = 30 * 60 * 1000;

export interface opts {
  connectionTimeout: number;
  port: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
  prebootChrome: boolean;
  rejectAlertURL: string | null;
  queuedAlertURL: string | null;
  timeoutAlertURL: string | null;
}

interface chrome {
  wsEndpoint: () => string;
  newPage: () => any;
  close: () => {};
}

export class Chrome {
  public port: number;
  public maxConcurrentSessions: number;
  public maxQueueLength: number;
  public connectionTimeout: number;

  private proxy: any;
  private prebootChrome: boolean;
  private chromeSwarm: Promise<chrome>[];
  private queue: any;
  private server: any;
  private debuggerScripts: any;
  private onRejected: Function;
  private onQueued: Function;
  private onTimedOut: Function;

  constructor(opts: opts) {
    this.port = opts.port;
    this.maxConcurrentSessions = opts.maxConcurrentSessions;
    this.maxQueueLength = opts.maxQueueLength + opts.maxConcurrentSessions;
    this.connectionTimeout = opts.connectionTimeout;
    this.chromeSwarm = [];
    this.prebootChrome = opts.prebootChrome;

    this.debuggerScripts = new Map();

    const addToSwarm = () => {
      if (this.prebootChrome && (this.chromeSwarm.length < this.maxConcurrentSessions)) {
        debug(`Adding Chrome instance to swarm, ${this.chromeSwarm.length} online`);
        this.chromeSwarm.push(this.launchChrome());
      }
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

    this.queue.on('success', addToSwarm);
    this.queue.on('error', addToSwarm);
    this.queue.on('timeout', (next, job) => {
      debug(`Timeout hit for session, closing. ${this.queue.length} in queue.`);
      this.onTimedOut();
      job.close();
      addToSwarm();
      next();
    });

    if (this.prebootChrome) {
      for (let i = 0; i < this.maxConcurrentSessions; i++) {
        this.chromeSwarm.push(this.launchChrome());
      }
    }

    this.onQueued = opts.queuedAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for queued session(s): ${opts.queuedAlertURL}`);
        request(opts.queuedAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    this.onRejected = opts.rejectAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for rejected session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    this.onTimedOut = opts.timeoutAlertURL ?
      _.debounce(() => {
        debug(`Calling webhook for timed-out session(s): ${opts.rejectAlertURL}`);
        request(opts.rejectAlertURL, _.noop);
      }, thiryMinutes, { leading: true, trailing: false }) :
      _.noop;

    debug({
      port: opts.port,
      connectionTimeout: opts.connectionTimeout,
      maxQueueLength: opts.maxQueueLength,
      maxConcurrentSessions: opts.maxConcurrentSessions,
      rejectAlertURL: opts.rejectAlertURL,
      timeoutAlertURL: opts.timeoutAlertURL,
      queuedAlertURL: opts.queuedAlertURL,
      prebootChrome: opts.prebootChrome,
    }, `Final Options`);
  }

  private async launchChrome(flags:string[] = []): Promise<chrome> {
    const start = Date.now();
    debug('Chrome Starting');
    return launch({
      args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
    })
      .then((chrome) => {
        debug(`Chrome launched ${Date.now() - start}ms`);
        return chrome;
      })
      .catch((error) => console.error(error));
  }

  public async startServer(): Promise<any> {
    const app = express();
    const upload = multer();

    app.use('/', express.static('public'));
    app.get('/json/version', (_req, res) => res.json(version));
    app.get('/json/protocol', (_req, res) => res.json(protocol));

    app.post('/execute', upload.single('file'), async (req, res) => {
      const targetId = chromeTarget();
      const code = `
      (async() => {
        ${req.file.buffer.toString().replace('debugger', 'page.evaluate(() => { debugger; })')}
      })().catch((error) => {
        console.error('Puppeteer Runtime Error:', error.stack);
      });`;

      debug(`/execute: Script uploaded\n${code}`);

      this.debuggerScripts.set(targetId, code);

      res.json({
        targetId,
        debuggerVersion: version['Debugger-Version']
      });
    });

    app.get('/json*', asyncMiddleware(async (req, res) => {
      const targetId = chromeTarget();
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
        const queueLength = this.queue.length;

        debug(`${req.url}: Inbound WebSocket request. ${queueLength} in queue.`);

        if (queueLength >= this.maxQueueLength) {
          debug(`${req.url}: Queue is full, rejecting`);
          socket.write('HTTP/1.1 429 Too Many Requests\r\n');
          socket.end();
          this.onRejected();
          return;
        }

        if (queueLength >= this.maxConcurrentSessions) {
          debug(`${req.url}: Concurrency limit hit, queueing`);
          this.onQueued();
        }

        const job:any = (done: () => {}) => {
          const parsedUrl = url.parse(req.url, true);
          const route = parsedUrl.pathname || '/';

          const flags = _.chain(parsedUrl.query)
            .pickBy((_value, param) => _.startsWith(param, '--'))
            .map((value, key) => `${key}${value ? `=${value}` : ''}`)
            .value();

          const canUseChromeSwarm = !flags.length && !!this.chromeSwarm.length;
          const launchPromise = canUseChromeSwarm ? this.chromeSwarm.shift() : this.launchChrome(flags);

          debug(`${req.url}: WebSocket upgrade.`);

          (launchPromise || this.launchChrome())
            .then(async (chrome) => {
              const browserWsEndpoint = chrome.wsEndpoint();

              debug(`${req.url}: Chrome Launched.`);

              socket.on('close', () => {
                debug(`${req.url}: Session closed, stopping Chrome. ${this.queue.length} in queue`);
                chrome.close();
                done();
              });

              if (!route.includes('/devtools/page')) {
                debug(`${req.url}: Proxying request to /devtools/browser route: ${browserWsEndpoint}.`);
                req.url = route;

                return browserWsEndpoint;
              }

              const page = await chrome.newPage();
              const port = url.parse(browserWsEndpoint).port;
              const pageLocation = `/devtools/page/${page._target._targetId}`;

              debug(`${req.url}: Proxying request to /devtools/page route: ${pageLocation}.`);

              if (this.debuggerScripts.has(route)) {
                const code = this.debuggerScripts.get(route);
                debug(`${req.url}: Loading prior-uploaded script to execute for route.`);

                const sandbox = {
                  page,
                  console: {
                    log: (...args) => page.evaluate((...args) => console.log(...args), ...args),
                    error: (...args) => page.evaluate((...args) => console.error(...args), ...args),
                    debug: (...args) => page.evaluate((...args) => console.debug(...args), ...args),
                  },
                };

                const vm = new VM({
                  sandbox,
                  timeout: this.connectionTimeout
                });

                this.debuggerScripts.delete(route);
                vm.run(code);
              }

              req.url = pageLocation;

              return `ws://127.0.0.1:${port}`;
            })
            .then((target) => this.proxy.ws(req, socket, head, { target }));
        };

        job.close = () => {
          socket.write('HTTP/1.1 408 Request has timed out\r\n');
          socket.end();
          socket.destroy('Request has timed out');
        };

        this.queue.push(job);
      }))
      .listen(this.port);
  }

  public async close() {
    this.server.close();
    this.proxy.close();
  }
}
