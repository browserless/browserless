import * as httpProxy from 'http-proxy';
import { launchChromeDriver } from './chrome-helper';
import { IDone, IJob } from './models/queue.interface';
import { Queue } from './queue';
import { getDebug } from './utils';

const debug = getDebug('webdriver');
const kill = require('tree-kill');

interface IWebDriverSession {
  chromeProcess: any;
  done: IDone;
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

  // Since Webdriver commands happen over HTTP, and aren't
  // maintained, we treat with the initial session request
  // with some special circumstances and use it inside our queue
  public start(req, res) {
    debug(`Inbound webdriver request`);
    req.headers.host = '127.0.0.1:3000';

    if (!this.queue.hasCapacity) {
      debug(`Too many concurrent and queued requests, rejecting.`);
      return res.end();
    }

    const earlyClose = () => {
      debug(`Request terminated prior to execution, removing from queue`);
      this.queue.remove(job);
    };

    const job: IJob = Object.assign(
      (done: IDone) => {
        req.removeListener('close', earlyClose);
        launchChromeDriver().then(({ port, chromeProcess }) => {
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

              job.close = () => {
                debug(`Killing chromedriver and proxy ${chromeProcess.pid}`);
                kill(chromeProcess.pid, 'SIGTERM');
                proxy.close();
                delete this.webDriverSessions[id];
              };
            });
          });

          proxy.web(req, res, (error) => {
            debug(`Issue in webdriver: ${error.message}`);
            res.end();
            done(error);
          });
        });
      }, {
        browser: null,
        close: () => {},
        id: '',
      },
    );

    req.once('close', earlyClose);
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

    session.proxy.once('proxyRes', () => session.done());

    session.proxy.web(req, res, (error) => {
      debug(`Issue in webdriver: ${error.message}`);
    });
  }

  public close() {
    for (const sessionId in this.webDriverSessions) {
      if (sessionId) {
        const session = this.webDriverSessions[sessionId];
        debug(`Killing chromedriver and proxy ${session.chromeProcess.pid}`);
        kill(session.chromeProcess.pid, 'SIGTERM');
        session.proxy.close();
        delete this.webDriverSessions[sessionId];
      }
    }
  }

  private getSession(req): IWebDriverSession | null {
    const urlParts = req.url.split('/');
    const sessionId = urlParts[3];

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
