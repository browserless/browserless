import * as _ from 'lodash';
import * as url from 'url';
import * as http from 'http';
import * as httpProxy from 'http-proxy';
import * as express from 'express';
import * as multer from 'multer';
import * as vm from 'vm';
import { launch } from 'puppeteer';

import { uuid } from './util';
import { log } from './logger';

const version = require('../version.json');
const protocol = require('../protocol.json');

const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        log.warn(error);
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

interface queue {
  flags: string[],
  opts: any,
  resolve: () => any,
}

interface session {
  chrome: chrome;
  page: any;
  id: string;
  time: NodeJS.Timer;
}

export class Chrome {
  public port: number;
  public maxConcurrentSessions: number;
  public maxQueueLength: number;
  public connectionTimeout: number;
  public debugConnectionTimeout: number;

  private activeClients: number;
  private cachedClients: {};
  private proxy: any;
  private queue: queue[];

  constructor(opts: opts) {
    this.port = opts.port;
    this.maxConcurrentSessions = opts.maxConcurrentSessions;
    this.maxQueueLength = opts.maxQueueLength;
    this.connectionTimeout = opts.connectionTimeout;
    this.debugConnectionTimeout = opts.debugConnectionTimeout;

    this.activeClients = 0;
    this.cachedClients = {};
    this.proxy = new httpProxy.createProxyServer();
    this.queue = [];

    this.proxy.on('error', function (err, _req, res) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });

      res.end(`Issue communicating with Chrome: "${err.message}"`);
    });

    log.info({
      maxConcurrentSessions: opts.maxConcurrentSessions,
      maxQueueLenth: opts.maxQueueLength,
      connectionTimeout: opts.connectionTimeout,
      debugConnectionTimeout: opts.debugConnectionTimeout,
      port: opts.port,
    }, `Final Options`);

    opts.logActivity && setInterval(() => {
      log.info({
        activeClients: Object.keys(this.cachedClients).length,
        queue: this.queue.length,
      });
    }, 5000);

    this.startServer();
  }

  private async launchChrome({ flags, opts, resolve }): Promise<chrome> {
    const start = Date.now();
    const args = flags.concat('--no-sandbox');
    this.activeClients = this.activeClients + 1;

    return launch({ ...opts, args })
      .then((chrome) => {
        log.info({ url: chrome.wsEndpoint() }, `Chrome launched in ${Date.now() - start}`);
        return resolve(chrome);
      })
      .catch((error) => log.error(error));
  }

  private async requestChrome(flags: string[] = [], opts = {}): Promise<chrome> {
    return new Promise<chrome>((resolve, reject) => {
      const args = flags.concat('--no-sandbox');

      if (this.queue.length >= this.maxQueueLength) {
        return reject('Maximum queue reached');
      }

      if (this.activeClients >= this.maxConcurrentSessions) {
        log.info(`Reach concurrency limit, queueing`);
        this.queue.push({ flags, opts, resolve });
        return;
      }

      log.info(`Launching Chrome: ${args.join(' ')}`);
      this.launchChrome({ flags, opts, resolve });
    });
  }

  private async cleanupSession(session) {
    log.info(`Session closing`);

    if (this.cachedClients[session.id]) {
      this.activeClients = this.activeClients - 1;
      delete this.cachedClients[session.id];
      _.attempt(() => {
        session.chrome.close();
        clearTimeout(session.timer);
      });
    }

    const nextJob = this.queue.length && this.queue.shift();

    if (nextJob) {
      log.info('Launching work from queue');
      this.launchChrome(nextJob);
    }
  }

  private async startChromeSession(flags: string[], opts: any, createNewPage: boolean): Promise<session> {
    let page: any;
    const chrome = await this.requestChrome(flags, opts);
    const port = url.parse(chrome.wsEndpoint()).port;
    if (createNewPage) {
      page = await chrome.newPage();
    }
    const id:string = page ? `/devtools/page/${page._client._targetId}` : uuid();

    // Cache page data so websockets upgrades can find them later
    const session = {
      id,
      chrome,
      page,
      port,
      target: createNewPage ? `ws://127.0.0.1:${port}` : chrome.wsEndpoint(),
      timer: this.connectionTimeout !== -1 ?
        setTimeout(() => this.cleanupSession(session), this.connectionTimeout) :
        null,
    };

    this.cachedClients[id] = session;

    return session;
  }

  private startServer() {
    const app = express();
    const upload = multer();

    app.post('/execute', upload.single('file'), async (req, res) => {
      const { page, id } = await this.startChromeSession([], { sloMo: 500 }, true);
      let code = req.file.buffer.toString();

      res.json({ targetId: id, debuggerVersion: version['Debugger-Version'] });

      code = code.replace('debugger', 'page.evaluate(() => { debugger; })');
      code = `(async() => { ${code} })().catch((error) => { console.error('Puppeteer Runtime Error:', error.stack); });`;

      const scope = {
        page,
        console: {
          log: (...args) => page.evaluate((...args) => console.log(...args), ...args),
          error: (...args) => page.evaluate((...args) => console.error(...args), ...args),
          debug: (...args) => page.evaluate((...args) => console.debug(...args), ...args),
        },
      };
  
      return vm.runInNewContext(code, scope);
    });

    app.get('/json/version', (_req, res) => {
      res.json(version);
    });

    app.get('/json/protocol', (_req, res) => {
      res.json(protocol);
    });

    app.get('/json*', asyncMiddleware(async (req, res) => {
      const { id } = await this.startChromeSession([], {}, true);
      const baseUrl = req.get('host');
      const protocol = req.protocol.includes('s') ? 'wss': 'ws';

      res.json([{
        targetId: id,
        description: '',
        devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${id}`,
        title: 'about:blank',
        type: 'page',
        url: 'about:blank',
        webSocketDebuggerUrl: `${protocol}://${baseUrl}${id}`
     }]);
    }));

    app.use('/', express.static('public'));

    http
      .createServer(app)
      .on('upgrade', asyncMiddleware(async(req, socket, head) => {
        const parsedUrl = url.parse(req.url, true);
        const route = parsedUrl.pathname || '/';
        const flags = _.chain(parsedUrl.query)
          .pickBy((_value, param) => _.startsWith(param, '--'))
          .map((value, key) => `${key}${value ? `=${value}` : ''}`)
          .value();

        // Strip qs params as it causes chrome to choke
        req.url = route;

        log.info(`Upgrade request for ${req.url}`);

        const priorSession = this.cachedClients[route];

        const session = !!priorSession ?
          priorSession :
          await this.startChromeSession(flags, {}, false);

        const close = () => {
          this.cleanupSession(session);
        };

        socket.on('close', close);
        socket.on('error', close);

        return this.proxy.ws(req, socket, head, { target: session.target });
      })) 
      .listen(this.port);
  }
}
