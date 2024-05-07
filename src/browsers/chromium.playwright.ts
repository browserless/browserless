import {
  BrowserServerOptions,
  Config,
  Logger,
  Request,
  ServerError,
} from '@browserless.io/browserless';
import playwright, { Page } from 'playwright-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import httpProxy from 'http-proxy';
import path from 'path';

export class ChromiumPlaywright extends EventEmitter {
  protected config: Config;
  protected userDataDir: string | null;
  protected running = false;
  protected logger: Logger;
  protected proxy = httpProxy.createProxyServer();
  protected browser: playwright.BrowserServer | null = null;
  protected browserWSEndpoint: string | null = null;
  protected executablePath = playwright.chromium.executablePath();

  constructor({
    config,
    userDataDir,
    logger,
  }: {
    config: Config;
    logger: Logger;
    userDataDir: ChromiumPlaywright['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.logger = logger;

    this.logger.info(`Starting new ${this.constructor.name} instance`);
  }

  protected cleanListeners() {
    this.removeAllListeners();
  }

  public isRunning = (): boolean => this.running;

  public close = async (): Promise<void> => {
    if (this.browser) {
      this.logger.info(
        `Closing ${this.constructor.name} process and all listeners`,
      );
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
    throw new ServerError(
      `#getPageId is not yet supported with ${this.constructor.name}.`,
    );
  };

  public makeLiveURL = (): void => {
    throw new ServerError(
      `Live URLs are not yet supported with ${this.constructor.name}. In the future this will be at "${this.config.getExternalAddress()}"`,
    );
  };

  public newPage = async (): Promise<Page> => {
    if (!this.browser || !this.browserWSEndpoint) {
      throw new ServerError(
        `${this.constructor.name} hasn't been launched yet!`,
      );
    }
    const browser = await playwright.chromium.connect(this.browserWSEndpoint);
    return await browser.newPage();
  };

  public launch = async (
    options: BrowserServerOptions = {},
  ): Promise<playwright.BrowserServer> => {
    this.logger.info(`Launching ${this.constructor.name} Handler`);

    this.browser = await playwright.chromium.launchServer({
      ...options,
      args: [
        `--no-sandbox`,
        ...(options.args || []),
        this.userDataDir ? `--user-data-dir=${this.userDataDir}` : '',
      ],
      executablePath: this.executablePath,
    });

    const browserWSEndpoint = this.browser.wsEndpoint();

    this.logger.info(
      `${this.constructor.name} is running on ${browserWSEndpoint}`,
    );
    this.running = true;
    this.browserWSEndpoint = browserWSEndpoint;

    return this.browser;
  };

  public wsEndpoint = (): string | null => this.browserWSEndpoint;

  public publicWSEndpoint = (token: string | null): string | null => {
    if (!this.browserWSEndpoint) {
      return null;
    }

    const externalURL = new URL(this.config.getExternalWebSocketAddress());
    const { pathname } = new URL(this.browserWSEndpoint);

    externalURL.pathname = path.join(externalURL.pathname, pathname);

    if (token) {
      externalURL.searchParams.set('token', token);
    }

    return externalURL.href;
  };

  public proxyPageWebSocket = async () => {
    this.logger.warn(`${this.constructor.name} Not yet implemented`);
  };

  public proxyWebSocket = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!this.browserWSEndpoint) {
        throw new ServerError(
          `No browserWSEndpoint found, did you launch first?`,
        );
      }
      socket.once('close', resolve);

      this.logger.info(
        `Proxying ${req.parsed.href} to ${this.constructor.name} ${this.browserWSEndpoint}`,
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
          this.logger.error(
            `Error proxying session to ${this.constructor.name}: ${error}`,
          );
          this.close();
          return reject(error);
        },
      );
    });
}
