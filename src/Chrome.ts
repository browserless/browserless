import * as _ from 'lodash';
import * as url from 'url';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as multer from 'multer';
import * as vm from 'vm';
import { launch } from 'puppeteer';

const chromeId = () => {
  var text = '';
  var possible = 'ABCDEF0123456789';

  for (var i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
};

const debug = require('debug')('browserless/chrome');
const queue = require('queue');
const version = require('../version.json');
const protocol = require('../protocol.json');

const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        console.warn(error);
        socket.write('HTTP/1.1 429 Too Many Requests\r\n');
        socket.end();
      });
  }
}

export interface opts {
  // How long each session has before closing
  connectionTimeout: number;

  // How long each debug session has before closing
  debugConnectionTimeout: number;

  // The port to expose for incoming requests (both http and ws)
  port: number;

  // Maximum number of concurrent sessions
  maxConcurrentSessions: number;

  // Maximum number to queue before 429'ing/reject requests
  maxQueueLength: number;

  // Logs activity every 5 seconds
  logActivity: boolean;
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
  public debugConnectionTimeout: number;

  private proxy: any;
  private queue: any[];
  private server: any;
  private debuggerScripts: any;

  constructor(opts: opts) {
    this.port = opts.port;
    this.maxConcurrentSessions = opts.maxConcurrentSessions;
    this.maxQueueLength = opts.maxQueueLength;
    this.connectionTimeout = opts.connectionTimeout;
    this.debugConnectionTimeout = opts.debugConnectionTimeout;

    this.debuggerScripts = new Map();

    this.proxy = new httpProxy.createProxyServer();
    this.proxy.on('error', function (err, _req, res) {
      console.log('ERR: ' + err);
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
      maxQueueLenth: opts.maxQueueLength,
      connectionTimeout: opts.connectionTimeout,
      debugConnectionTimeout: opts.debugConnectionTimeout,
      port: opts.port,
    }, `Final Options`);

    opts.logActivity && setInterval(() => {
      debug({
        queue: this.queue.length,
      });
    }, 5000);
  }

  private async launchChrome({ flags, opts }): Promise<chrome> {
    const start = Date.now();
    const args = flags.concat('--no-sandbox');

    return launch({ ...opts, args })
      .then((chrome) => {
        debug(`${chrome.wsEndpoint()}: Chrome launched in ${Date.now() - start}`);
        return chrome;
      })
      .catch((error) => console.error(error));
  }

  public async startServer(): Promise<any> {
    const app = express();
    const upload = multer();

    app.post('/execute', upload.single('file'), async (req, res) => {
      const targetId = `/devtools/page/${chromeId()}`;
      const code = `
      (async() => {
        ${req.file.buffer.toString().replace('debugger', 'page.evaluate(() => { debugger; })')}
      })().catch((error) => {
        console.error('Puppeteer Runtime Error:', error.stack);
      });`;

      this.debuggerScripts.set(targetId, code);

      res.json({
        targetId,
        debuggerVersion: version['Debugger-Version']
      });
    });

    app.get('/json/version', (_req, res) => {
      res.json(version);
    });

    app.get('/json/protocol', (_req, res) => {
      res.json(protocol);
    });

    // app.get('/json*', asyncMiddleware(async (req, res) => {
    //   const sessionId = uuid();
    //   const removeFromQueue = () => this.removeFromQueue(sessionId);

    //   req.on('end', removeFromQueue);

    //   const { targetId } = await this.startChromeSession({
    //     flags: [],
    //     opts: {},
    //     createNewPage: true,
    //     sessionId,
    //     timeout: this.connectionTimeout,
    //   });

    //   req.removeListener('end', removeFromQueue);

    //   const baseUrl = req.get('host');
    //   const protocol = req.protocol.includes('s') ? 'wss': 'ws';

    //   res.json([{
    //     targetId,
    //     description: '',
    //     devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
    //     title: 'about:blank',
    //     type: 'page',
    //     url: 'about:blank',
    //     webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`
    //  }]);
    // }));

    app.use('/', express.static('public'));

    return this.server = http
      .createServer(app)
      .on('upgrade', asyncMiddleware(async(req, socket, head) => {
        debug(`WebSocket connection upgrade request, queue: ${this.queue.length}`);
        this.queue.push((done) => {
          const parsedUrl = url.parse(req.url, true);
          const route = parsedUrl.pathname || '/';

          const flags = _.chain(parsedUrl.query)
            .pickBy((_value, param) => _.startsWith(param, '--'))
            .map((value, key) => `${key}${value ? `=${value}` : ''}`)
            .value();

          // Strip qs params as it causes chrome to choke
          req.url = route;

          socket.on('close', done);

          this.launchChrome({ flags, opts: {} })
            .then(async (chrome) => {
              const browserWsEndpoint = chrome.wsEndpoint();

              if (this.debuggerScripts.has(route)) {
                const page = await chrome.newPage();
                const port = url.parse(browserWsEndpoint).port;
                req.url = `/devtools/page/${page._target._targetId}`;

                const scope = {
                  page,
                  console: {
                    log: (...args) => page.evaluate((...args) => console.log(...args), ...args),
                    error: (...args) => page.evaluate((...args) => console.error(...args), ...args),
                    debug: (...args) => page.evaluate((...args) => console.debug(...args), ...args),
                  },
                };

                vm.runInNewContext(this.debuggerScripts.get(route), scope);

                return `ws://127.0.0.1:${port}`;
              }
              return browserWsEndpoint;
            })
            .then((target) => {
              debug(`Proxying request ${req.url} to ${target}`);
              this.proxy.ws(req, socket, head, { target });
            });
        });
      }))
      .listen(this.port);
  }

  public async close() {
    this.server.close();
    this.proxy.close();
  }
}
