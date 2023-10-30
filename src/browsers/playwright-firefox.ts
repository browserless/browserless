import { EventEmitter } from 'events';
import { Duplex } from 'stream';

import httpProxy from 'http-proxy';
import playwright, { Page } from 'playwright-core';

import { Config } from 'src/config.js';

import { Request } from '../http.js';
import { BrowserServerOptions } from '../types.js';
import * as util from '../utils.js';

export class PlaywrightFirefox extends EventEmitter {
  private config: Config;
  private userDataDir: string | null;
  private record: boolean;
  private running = false;
  private proxy = httpProxy.createProxyServer();
  private browser: playwright.BrowserServer | null = null;
  private browserWSEndpoint: string | null = null;
  private debug = util.createLogger('browsers:playwright:firefox');

  constructor({
    config,
    userDataDir,
    record,
  }: {
    config: Config;
    record: boolean;
    userDataDir: PlaywrightFirefox['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.record = record;

    this.debug(`Starting new browser instance`);
  }

  private cleanListeners() {
    this.removeAllListeners();
  }

  public isRunning = (): boolean => this.running;

  public close = async (): Promise<void> => {
    if (this.browser) {
      this.debug(`Closing browser process and all listeners`);
      this.emit('close');
      this.cleanListeners();
      this.browser.close();
      this.running = false;
      this.browser = null;
      this.browserWSEndpoint = null;
    }
  };

  public pages = async (): Promise<[]> => [];

  public getPageId = (): string => {
    throw new util.ServerError(
      `#getPageId is not yet supported with this browser.`,
    );
  };

  public makeLiveURL = (): void => {
    throw new util.ServerError(
      `Live URLs are not yet supported with this browser.`,
    );
  };

  public newPage = async (): Promise<Page> => {
    throw new util.ServerError(`Can't create new page with this browser`);
  };

  public launch = async (
    options: BrowserServerOptions = {},
  ): Promise<playwright.BrowserServer> => {
    if (this.record) {
      throw new util.ServerError(
        `Recording is not yet available with this browser`,
      );
    }

    this.debug(`Launching Firefox Handler`);

    this.browser = await playwright.firefox.launchServer({
      ...options,
      args: [this.userDataDir ? `-profile=${this.userDataDir}` : ''],
      executablePath: playwright.firefox.executablePath(),
    });

    const browserWSEndpoint = this.browser.wsEndpoint();

    this.debug(`Browser is running on ${browserWSEndpoint}`);
    this.browserWSEndpoint = browserWSEndpoint;
    this.running = true;

    return this.browser;
  };

  public wsEndpoint = (): string | null => this.browserWSEndpoint;

  public publicWSEndpoint = (token: string): string | null => {
    if (!this.browserWSEndpoint) {
      return null;
    }

    const wsURL = new URL(this.browserWSEndpoint);
    const serverURL = new URL(this.config.getExternalAddress());

    wsURL.hostname = serverURL.hostname;
    wsURL.port = serverURL.port;
    wsURL.protocol = serverURL.protocol === 'https' ? 'wss' : 'ws';
    wsURL.searchParams.set('token', token);

    return wsURL.href;
  };

  public proxyPageWebSocket = async () => {
    console.warn(`Not yet implemented`);
  };

  public proxyWebSocket = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!this.browserWSEndpoint) {
        throw new util.ServerError(
          `No browserWSEndpoint found, did you launch first?`,
        );
      }
      socket.once('close', resolve);

      this.debug(
        `Proxying ${req.parsed.href} to browser ${this.browserWSEndpoint}`,
      );

      // Delete headers known to cause issues
      delete req.headers.origin;

      req.url = '';

      this.proxy.ws(
        req,
        socket,
        head,
        {
          changeOrigin: true,
          target: this.browserWSEndpoint,
        },
        (error) => {
          this.debug(`Error proxying session: ${error}`);
          this.close();
          return reject(error);
        },
      );
    });
}
