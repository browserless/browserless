import * as _ from 'lodash';
import * as url from 'url';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as multer from 'multer';
import * as vm from 'vm';
import { launch } from 'puppeteer';

const debug = require('debug')('browserless/chrome');
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

export interface opts {
  connectionTimeout: number;
  port: number;
  maxConcurrentSessions: number;
  maxQueueLength: number;
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
  private queue: any[];
  private server: any;
  private debuggerScripts: any;

  constructor(opts: opts) {
    this.port = opts.port;
    this.maxConcurrentSessions = opts.maxConcurrentSessions;
    this.maxQueueLength = opts.maxQueueLength;
    this.connectionTimeout = opts.connectionTimeout;

    this.debuggerScripts = new Map();

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
      concurrency: opts.maxConcurrentSessions,
      timeout: opts.connectionTimeout,
      autostart: true
    });

    debug({
      maxConcurrentSessions: opts.maxConcurrentSessions,
      maxQueueLength: opts.maxQueueLength,
      connectionTimeout: opts.connectionTimeout,
      port: opts.port,
    }, `Final Options`);
  }

  private async launchChrome({ flags, opts }): Promise<chrome> {
    return launch({
      ...opts,
      args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
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
        debug(`${req.url}: Inbound WebSocket request, ${this.queue.length} in queue.`);

        if (this.queue.length >= this.maxQueueLength) {
          debug(`${req.url}: Queue is full, rejecting`);
          socket.write('HTTP/1.1 429 Too Many Requests\r\n');
          socket.end();
          return;
        }

        this.queue.push((done) => {
          const parsedUrl = url.parse(req.url, true);
          const route = parsedUrl.pathname || '/';

          const flags = _.chain(parsedUrl.query)
            .pickBy((_value, param) => _.startsWith(param, '--'))
            .map((value, key) => `${key}${value ? `=${value}` : ''}`)
            .value();

          debug(`${req.url}: Launching Chrome for WebSocket upgrade.`);

          this.launchChrome({ flags, opts: {} })
            .then(async (chrome) => {
              const browserWsEndpoint = chrome.wsEndpoint();

              debug(`${req.url}: Chrome Launched.`);

              socket.on('close', () => {
                debug(`${req.url}: Session closed. ${this.queue.length} in queue`);
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
                const scope = {
                  page,
                  console: {
                    log: (...args) => page.evaluate((...args) => console.log(...args), ...args),
                    error: (...args) => page.evaluate((...args) => console.error(...args), ...args),
                    debug: (...args) => page.evaluate((...args) => console.debug(...args), ...args),
                  },
                };

                this.debuggerScripts.delete(route);
                vm.runInNewContext(code, scope);
              }

              req.url = pageLocation;

              return `ws://127.0.0.1:${port}`;
            })
            .then((target) => this.proxy.ws(req, socket, head, { target }));
        });
      }))
      .listen(this.port);
  }

  public async close() {
    this.server.close();
    this.proxy.close();
  }
}
