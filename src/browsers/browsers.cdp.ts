import {
  BLESS_PAGE_IDENTIFIER,
  BrowserLauncherOptions,
  Config,
  Logger,
  Request,
  ServerError,
  chromeExecutablePath,
  edgeExecutablePath,
  noop,
  once,
  ublockLitePath,
} from '@browserless.io/browserless';
import puppeteer, { Browser, Page, Target } from 'puppeteer-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
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

  public keepUntil() {
    return 0;
  }

  public getPageId(page: Page): string {
    // @ts-ignore
    return page.target()._targetId;
  }

  protected async onTargetCreated(target: Target) {
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
  }

  public isRunning(): boolean {
    return this.running;
  }

  public async newPage(): Promise<Page> {
    if (!this.browser) {
      throw new ServerError(
        `${this.constructor.name} hasn't been launched yet!`,
      );
    }

    return this.browser.newPage();
  }

  public async close(): Promise<void> {
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
  }

  public async pages(): Promise<Page[]> {
    return this.browser?.pages() || [];
  }

  public process() {
    return this.browser?.process() || null;
  }

  public async launch({
    options,
    stealth,
  }: BrowserLauncherOptions): Promise<Browser> {
    this.port = await getPort();
    this.logger.info(`${this.constructor.name} got open port ${this.port}`);

    const extensionLaunchArgs = options.args?.find((a) =>
      a.startsWith('--load-extension'),
    );

    // Remove extension flags as we recompile them below with our own
    options.args = options.args?.filter(
      (a) =>
        !a.startsWith('--load-extension') &&
        !a.startsWith('--disable-extensions-except'),
    );

    const extensions = [
      this.blockAds ? ublockLitePath : null,
      extensionLaunchArgs ? extensionLaunchArgs.split('=')[1] : null,
    ].filter((_) => !!_);

    // Bypass the host we bind to so things like /function can work with proxies
    if (options.args?.some((arg) => arg.includes('--proxy-server'))) {
      const defaultBypassList = [
        this.config.getHost(),
        new URL(this.config.getExternalAddress()).hostname,
      ];
      const bypassProxyListIdx = options.args?.findIndex((arg) =>
        arg.includes('--proxy-bypass-list'),
      );
      if (bypassProxyListIdx !== -1) {
        options.args[bypassProxyListIdx] =
          `--proxy-bypass-list=` +
          [options.args[bypassProxyListIdx].split('=')[1], ...defaultBypassList]
            .filter((_) => !!_)
            .join(';');
      } else {
        options.args.push(`--proxy-bypass-list=${defaultBypassList.join(';')}`);
      }
    }

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

    if (extensions.length) {
      finalOptions.args.push(
        '--load-extension=' + extensions.join(','),
        '--disable-extensions-except=' + extensions.join(','),
      );
    }

    const launch = stealth
      ? puppeteerStealth.launch.bind(puppeteerStealth)
      : puppeteer.launch.bind(puppeteer);

    this.logger.info(
      finalOptions,
      `Launching ${this.constructor.name} Handler`,
    );
    this.browser = (await launch(finalOptions)) as Browser;
    this.browser.on('targetcreated', this.onTargetCreated.bind(this));
    this.running = true;
    this.browserWSEndpoint = this.browser.wsEndpoint();
    this.logger.info(
      `${this.constructor.name} is running on ${this.browserWSEndpoint}`,
    );

    return this.browser;
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

  public async proxyPageWebSocket(
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    return new Promise(async (resolve, reject) => {
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
}

export class ChromeCDP extends ChromiumCDP {
  protected executablePath = chromeExecutablePath();
}

export class EdgeCDP extends ChromiumCDP {
  protected executablePath = edgeExecutablePath();
}
