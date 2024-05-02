import {
  BLESS_PAGE_IDENTIFIER,
  CDPLaunchOptions,
  Config,
  Logger,
  Request,
  ServerError,
  noop,
  once,
} from '@browserless.io/browserless';
import puppeteer, { Browser, Page, Target } from 'puppeteer-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { fileURLToPath } from 'url';
import getPort from 'get-port';
import httpProxy from 'http-proxy';
import path from 'path';
import playwright from 'playwright-core';
import puppeteerStealth from 'puppeteer-extra';

puppeteerStealth.use(StealthPlugin());

export class ChromiumCDP extends EventEmitter {
  protected config: Config;
  protected userDataDir: string | null;
  protected blockAds: boolean;
  protected running = false;
  protected browser: Browser | null = null;
  protected browserWSEndpoint: string | null = null;
  protected port?: number;
  protected logger: Logger;
  protected proxy = httpProxy.createProxyServer();
  protected executablePath = playwright.chromium.executablePath();

  constructor({
    blockAds,
    config,
    userDataDir,
    logger,
  }: {
    blockAds: boolean;
    config: Config;
    logger: Logger;
    userDataDir: ChromiumCDP['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.blockAds = blockAds;
    this.logger = logger;

    this.logger.info(`Starting new ${this.constructor.name} instance`);
  }

  protected cleanListeners() {
    this.browser?.removeAllListeners();
    this.removeAllListeners();
  }

  public getPageId = (page: Page): string => {
    // @ts-ignore
    return page.target()._targetId;
  };

  protected onTargetCreated = async (target: Target) => {
    if (target.type() === 'page') {
      const page = await target.page().catch((e) => {
        this.logger.error(`Error in ${this.constructor.name} new page ${e}`);
        return null;
      });

      if (page) {
        this.logger.trace(`Setting up file:// protocol request rejection`);

        page.on('error', (err) => {
          this.logger.error(err);
        });

        page.on('pageerror', (err) => {
          this.logger.warn(err);
        });

        page.on('framenavigated', (frame) => {
          this.logger.trace(`Navigation to ${frame.url()}`);
        });

        page.on('console', (message) => {
          this.logger.trace(`${message.type()}: ${message.text()}`);
        });

        page.on('requestfailed', (req) => {
          this.logger.warn(`"${req.failure()?.errorText}": ${req.url()}`);
        });

        page.on('request', async (request) => {
          this.logger.trace(`${request.method()}: ${request.url()}`);
          if (
            !this.config.getAllowFileProtocol() &&
            request.url().startsWith('file://')
          ) {
            this.logger.error(
              `File protocol request found in request to ${this.constructor.name}, terminating`,
            );
            page.close().catch(noop);
            this.close();
          }
        });

        page.on('response', async (response) => {
          this.logger.trace(`${response.status()}: ${response.url()}`);

          if (
            !this.config.getAllowFileProtocol() &&
            response.url().startsWith('file://')
          ) {
            this.logger.error(
              `File protocol request found in response to ${this.constructor.name}, terminating`,
            );
            page.close().catch(noop);
            this.close();
          }
        });

        this.emit('newPage', page);
      }
    }
  };

  public isRunning = (): boolean => this.running;

  public newPage = async (): Promise<Page> => {
    if (!this.browser) {
      throw new ServerError(
        `${this.constructor.name} hasn't been launched yet!`,
      );
    }

    return this.browser.newPage();
  };

  public close = async (): Promise<void> => {
    if (this.browser) {
      this.logger.info(
        `Closing ${this.constructor.name} process and all listeners`,
      );
      this.emit('close');
      this.cleanListeners();
      this.browser.removeAllListeners();
      this.browser.close();
      this.running = false;
      this.browser = null;
      this.browserWSEndpoint = null;
    }
  };

  public pages = async (): Promise<Page[]> => this.browser?.pages() || [];

  public process = () => this.browser?.process() || null;

  public launch = async (options: CDPLaunchOptions = {}): Promise<Browser> => {
    this.port = await getPort();
    this.logger.info(`${this.constructor.name} got open port ${this.port}`);
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const finalOptions = {
      ...options,
      args: [
        `--remote-debugging-port=${this.port}`,
        `--no-sandbox`,
        ...(options.args || []),
        this.userDataDir ? `--user-data-dir=${this.userDataDir}` : '',
      ].filter((_) => !!_),
      executablePath: this.executablePath,
    };

    if (this.blockAds) {
      // Necessary to load extensions
      finalOptions.headless = false;

      const loadExtensionPaths: string = path.join(
        __dirname,
        '..',
        '..',
        'extensions',
        'ublock',
      );

      finalOptions.args.push(
        '--load-extension=' + loadExtensionPaths,
        '--disable-extensions-except=' + loadExtensionPaths,
      );
    }

    const launch = options.stealth
      ? puppeteerStealth.launch.bind(puppeteerStealth)
      : puppeteer.launch.bind(puppeteer);

    this.logger.info(
      finalOptions,
      `Launching ${this.constructor.name} Handler`,
    );
    this.browser = (await launch(finalOptions)) as Browser;
    this.browser.on('targetcreated', this.onTargetCreated);
    this.running = true;
    this.browserWSEndpoint = this.browser.wsEndpoint();
    this.logger.info(
      `${this.constructor.name} is running on ${this.browserWSEndpoint}`,
    );

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

  public proxyPageWebSocket = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> =>
    new Promise(async (resolve, reject) => {
      if (!this.browserWSEndpoint || !this.browser) {
        throw new ServerError(
          `No browserWSEndpoint found, did you launch first?`,
        );
      }
      socket.once('close', resolve);
      this.logger.info(
        `Proxying ${req.parsed.href} to ${this.constructor.name}`,
      );

      const shouldMakePage = req.parsed.pathname.includes(
        BLESS_PAGE_IDENTIFIER,
      );
      const page = shouldMakePage ? await this.browser.newPage() : null;
      const pathname = page
        ? path.join('/devtools', '/page', this.getPageId(page))
        : req.parsed.pathname;
      const target = new URL(pathname, this.browserWSEndpoint).href;
      req.url = '';

      // Delete headers known to cause issues
      delete req.headers.origin;

      this.proxy.ws(
        req,
        socket,
        head,
        {
          changeOrigin: true,
          target,
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

      const close = once(() => {
        this.browser?.off('close', close);
        this.browser?.process()?.off('close', close);
        socket.off('close', close);
        return resolve();
      });

      this.browser?.once('close', close);
      this.browser?.process()?.once('close', close);
      socket.once('close', close);

      this.logger.info(
        `Proxying ${req.parsed.href} to ${this.constructor.name} ${this.browserWSEndpoint}`,
      );

      req.url = '';

      // Delete headers known to cause issues
      delete req.headers.origin;

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
