import {
  BLESS_PAGE_IDENTIFIER,
  CDPLaunchOptions,
  Config,
  Request,
  ServerError,
  createLogger,
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
  protected debug = createLogger('browsers:chromium:cdp');
  protected proxy = httpProxy.createProxyServer();
  protected executablePath = playwright.chromium.executablePath();

  constructor({
    blockAds,
    config,
    userDataDir,
  }: {
    blockAds: boolean;
    config: Config;
    userDataDir: ChromiumCDP['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.blockAds = blockAds;
    this.debug(`Starting new browser instance`);
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
        this.debug(`Error in new page ${e}`);
        return null;
      });

      if (page) {
        if (!this.config.getAllowFileProtocol()) {
          this.debug(`Setting up file:// protocol request rejection`);
          page.on('request', async (request) => {
            if (request.url().startsWith('file://')) {
              this.debug(`File protocol request found in request, terminating`);
              page.close().catch(noop);
              this.close();
            }
          });

          page.on('response', async (response) => {
            if (response.url().startsWith('file://')) {
              this.debug(
                `File protocol request found in response, terminating`,
              );
              page.close().catch(noop);
              this.close();
            }
          });
        }
        this.emit('newPage', page);
      }
    }
  };

  public isRunning = (): boolean => this.running;

  public newPage = async (): Promise<Page> => {
    if (!this.browser) {
      throw new ServerError(`Browser hasn't been launched yet!`);
    }

    return this.browser.newPage();
  };

  public close = async (): Promise<void> => {
    if (this.browser) {
      this.debug(`Closing browser process and all listeners`);
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
    this.debug(`Got open port ${this.port}`);
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

    this.debug(finalOptions, `Launching CDP Handler`);
    // @ts-ignore mis-matched types from stealth...
    this.browser = (await launch(finalOptions)) as Browser;
    this.browser.on('targetcreated', this.onTargetCreated);
    this.running = true;
    this.browserWSEndpoint = this.browser.wsEndpoint();
    this.debug(`Browser is running on ${this.browserWSEndpoint}`);

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
      this.debug(`Proxying ${req.parsed.href}`);

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
          this.debug(`Error proxying session: ${error}`);
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

      this.debug(
        `Proxying ${req.parsed.href} to browser ${this.browserWSEndpoint}`,
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
          this.debug(`Error proxying session: ${error}`);
          this.close();
          return reject(error);
        },
      );
    });
}
