import {
  BrowserServerOptions,
  Config,
  Logger,
  Request,
  ServerError,
  chromeExecutablePath,
} from '@browserless.io/browserless';
import playwright, { Page } from 'playwright-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import httpProxy from 'http-proxy';
import path from 'path';

enum PlaywrightBrowserTypes {
  chromium = 'chromium',
  firefox = 'firefox',
  webkit = 'webkit',
}

class BasePlaywright extends EventEmitter {
  protected config: Config;
  protected userDataDir: string | null;
  protected running = false;
  protected logger: Logger;
  protected proxy = httpProxy.createProxyServer();
  protected browser: playwright.BrowserServer | null = null;
  protected browserWSEndpoint: string | null = null;
  protected playwrightBrowserType: PlaywrightBrowserTypes = PlaywrightBrowserTypes.chromium;
  protected executablePath = () => playwright[this.playwrightBrowserType].executablePath();

  constructor({
    config,
    userDataDir,
    logger,
  }: {
    config: Config;
    logger: Logger;
    userDataDir: BasePlaywright['userDataDir'];
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

  protected makeLaunchOptions(opts: BrowserServerOptions) {
    return {
      ...opts,
      args: [
        ...(opts.args || []),
        this.userDataDir ? `--user-data-dir=${this.userDataDir}` : '',
      ],
      executablePath: this.executablePath(),
    };
  }

  public keepUntil() {
    return 0;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async close(): Promise<void> {
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
  }

  public async pages(): Promise<[]> {
    return [];
  }

  public getPageId(): string {
    throw new ServerError(
      `#getPageId is not yet supported with ${this.constructor.name}.`,
    );
  }

  public makeLiveURL(): void {
    throw new ServerError(
      `Live URLs are not yet supported with ${this.constructor.name}. In the future this will be at "${this.config.getExternalAddress()}"`,
    );
  }

  public async newPage(): Promise<Page> {
    if (!this.browser || !this.browserWSEndpoint) {
      throw new ServerError(
        `${this.constructor.name} hasn't been launched yet!`,
      );
    }
    const browser = await playwright[this.playwrightBrowserType].connect(this.browserWSEndpoint);
    return await browser.newPage();
  }

  public async launch(
    options: BrowserServerOptions = {},
    version?: string,
  ): Promise<playwright.BrowserServer> {
    this.logger.info(`Launching ${this.constructor.name} Handler`);

    const opts = this.makeLaunchOptions(options);
    const versionedPw = await this.config.loadPwVersion(version!);
    const browser = await versionedPw[this.playwrightBrowserType].launchServer(opts);
    const browserWSEndpoint = browser.wsEndpoint();

    this.logger.info(
      `${this.constructor.name} is running on ${browserWSEndpoint}`,
    );
    this.running = true;
    this.browserWSEndpoint = browserWSEndpoint;
    this.browser = browser;

    return browser;
  }

  public wsEndpoint(): string | null {
    return this.browserWSEndpoint;
  }

  public publicWSEndpoint(token: string | null): string | null {
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
  }

  public async proxyPageWebSocket() {
    this.logger.error(`Not yet implemented in ${this.constructor.name}`);
  }

  public async proxyWebSocket(
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
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
}

export class ChromiumPlaywright extends BasePlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.chromium;
}

export class ChromePlaywright extends ChromiumPlaywright {
  protected executablePath = () => chromeExecutablePath();
  protected playwrightBrowserType = PlaywrightBrowserTypes.chromium;
}

export class FirefoxPlaywright extends BasePlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.firefox;

  protected makeLaunchOptions(opts: BrowserServerOptions) {
    return {
      ...opts,
      args: [
        ...(opts.args || []),
        this.userDataDir ? `-profile=${this.userDataDir}` : '',
      ],
      executablePath: this.executablePath(),
    };
  }
}

export class WebKitPlaywright extends BasePlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.webkit;

  protected makeLaunchOptions(opts: BrowserServerOptions) {
    return {
      ...opts,
      args: [
        ...(opts.args || []),
        this.userDataDir ? `-profile=${this.userDataDir}` : '',
      ],
      executablePath: this.executablePath(),
    };
  }
}
