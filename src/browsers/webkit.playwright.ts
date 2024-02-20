import {
  BrowserServerOptions,
  Config,
  Request,
  ServerError,
  createLogger,
} from '@browserless.io/browserless';
import playwright, { Page } from 'playwright-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import httpProxy from 'http-proxy';

export class WebkitPlaywright extends EventEmitter {
  protected config: Config;
  protected userDataDir: string | null;
  protected record: boolean;
  protected running = false;
  protected proxy = httpProxy.createProxyServer();
  protected browser: playwright.BrowserServer | null = null;
  protected browserWSEndpoint: string | null = null;
  protected debug = createLogger('browsers:webkit:playwright');

  constructor({
    config,
    userDataDir,
    record,
  }: {
    config: Config;
    record: boolean;
    userDataDir: WebkitPlaywright['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.record = record;

    this.debug(`Starting new browser instance`);
  }

  protected cleanListeners() {
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
    throw new ServerError(`#getPageId is not yet supported with this browser.`);
  };

  public makeLiveURL = (): void => {
    throw new ServerError(`Live URLs are not yet supported with this browser.`);
  };

  public newPage = async (): Promise<Page> => {
    throw new ServerError(`Can't create new page with this browser`);
  };

  public launch = async (
    options: BrowserServerOptions = {},
  ): Promise<playwright.BrowserServer> => {
    if (this.record) {
      throw new ServerError(`Recording is not yet available with this browser`);
    }

    this.debug(`Launching Playwright Handler`);

    this.browser = await playwright.webkit.launchServer({
      ...options,
      args: [
        ...(options.args || []),
        this.userDataDir ? `-profile=${this.userDataDir}` : '',
      ],
      executablePath: playwright.webkit.executablePath(),
    });

    const browserWSEndpoint = this.browser.wsEndpoint();

    this.debug(`Browser is running on ${browserWSEndpoint}`);
    this.browserWSEndpoint = browserWSEndpoint;
    this.running = true;

    return this.browser;
  };

  public wsEndpoint = (): string | null => this.browserWSEndpoint;

  public publicWSEndpoint = (token: string | null): string | null => {
    if (!this.browserWSEndpoint) {
      return null;
    }

    const serverURL = new URL(this.config.getExternalWebSocketAddress());
    const wsURL = new URL(this.browserWSEndpoint);
    wsURL.host = serverURL.host;
    wsURL.port = serverURL.port;

    if (token) {
      wsURL.searchParams.set('token', token);
    }

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
        throw new ServerError(
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
