import * as chromeDriver from 'chromedriver';
import * as httpProxy from 'http-proxy';
import { Queue } from './queue';
import { getDebug } from './utils';

const debug = getDebug('webdriver');
const kill = require('tree-kill');
const getPort = require('get-port');

interface IWebDriverSession {
  chromeProcess: any;
  done: () => any;
  sessionId: string;
  proxy: any;
}

interface IWebDriverSessions {
  [key: string]: IWebDriverSession;
}

export class WebDriver {
  private queue: Queue;
  private webDriverSessions: IWebDriverSessions;

  constructor(queue) {
    this.queue = queue;
    this.webDriverSessions = {};
  }

  public start(req, res) {
    debug(`Inbound webdriver request`);

    const handler = (done: () => {}) => {
      getPort().then((port) => {
        const chromeProcess = chromeDriver.start([
          '--url-base=wd/hub',
          `--port=${port}`,
          // '--verbose',
        ]);

        job.close = () => {
          debug(`Killing chromedriver ${chromeProcess.pid}`);
          kill(chromeProcess.pid, 'SIGKILL');
        };

        chromeProcess.stdout.on('data', () => {
          debug(`chrome-driver started`);
          const proxy = new httpProxy.createProxyServer({ target: `http://localhost:${port}` });

          proxy.once('proxyRes', (proxyRes) => {
            let body = new Buffer('');
            proxyRes.on('data', (data) => body = Buffer.concat([body, data]));
            proxyRes.on('end', () => {
              const responseBody = body.toString();
              const session = JSON.parse(responseBody);
              const id = session.sessionId;
              debug('Session started, got body: ', responseBody);

              job.id = id;

              this.webDriverSessions[id] = {
                chromeProcess,
                done,
                proxy,
                sessionId: id,
              };
            });
          });

          proxy.web(req, res, (error) => {
            debug(`Issue in webdriver: ${error.message}`);
          });
        });
      });
    };

    const job = Object.assign(handler, {
      browser: null,
      close: () => {},
      id: '',
    });

    this.queue.add(job);
  }

  public proxySession(req, res) {
    debug(`Inbound webdriver command`);
    const session = this.getSession(req);

    if (!session) {
      return res.end();
    }

    return session.proxy.web(req, res, (error) => {
      debug(`Issue in webdriver: ${error.message}`);
    });
  }

  public closeSession(req, res) {
    debug(`Inbound webdriver close`);
    const session = this.getSession(req);

    if (!session) {
      return res.end();
    }

    session.proxy.once('proxyRes', () => {
      session.done();
      delete this.webDriverSessions[session.sessionId];
    });

    session.proxy.web(req, res, (error) => {
      debug(`Issue in webdriver: ${error.message}`);
    });
  }

  private getSession(req): IWebDriverSession | null {
    const urlParts = req.url.split('/');
    const sessionId = urlParts[4];

    if (!sessionId) {
      debug(`Couldn't load session for URL ${req.url}`);
      return null;
    }
    const session = this.webDriverSessions[sessionId];

    if (!session) {
      debug(`No session exists for URL ${req.url}, sessionId ${sessionId}`);
      return null;
    }

    return session;
  }
}
