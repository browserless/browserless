import { EventEmitter } from 'events';
import path from 'path';
import { Duplex } from 'stream';
import { fileURLToPath } from 'url';

import getPort from 'get-port';

import httpProxy from 'http-proxy';
import playwright from 'playwright-core';
import puppeteer, { Page, Browser, Target } from 'puppeteer-core';
import puppeteerStealth from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import { Config } from '../config.js';
import { liveURLSep } from '../constants.js';
import { Request } from '../http.js';
import { CDPLaunchOptions } from '../types.js';
import * as util from '../utils.js';

puppeteerStealth.use(StealthPlugin());

export class CDPChromium extends EventEmitter {
  private config: Config;
  private userDataDir: string | null;
  private record: boolean;
  private blockAds: boolean;
  private running = false;
  private browser: Browser | null = null;
  private browserWSEndpoint: string | null = null;
  private port?: number;
  private debug = util.createLogger('browsers:cdp:chromium');
  private proxy = httpProxy.createProxyServer();

  constructor({
    userDataDir,
    config,
    record,
    blockAds,
  }: {
    blockAds: boolean;
    config: Config;
    record: boolean;
    userDataDir: CDPChromium['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.record = record;
    this.blockAds = blockAds;
    this.debug(`Starting new browser instance`);
  }

  private cleanListeners() {
    this.browser?.removeAllListeners();
    this.removeAllListeners();
  }

  private setUpEmbeddedAPI = async (
    page: Page,
    id: string,
    record: boolean,
  ): Promise<void> => {
    const pageId = this.getPageId(page);
    const liveUrl = this.makeLiveURL(id, pageId);
    const embeddedAPI = (pageId: string, liveUrl: string, record: boolean) => {
      Object.defineProperty(window, 'browserless', {
        configurable: false,
        enumerable: false,
        value: {},
        writable: false,
      });

      Object.defineProperties(window.browserless, {
        liveUrl: {
          configurable: false,
          enumerable: false,
          value: () => liveUrl,
          writable: false,
        },
        pageId: {
          configurable: false,
          enumerable: false,
          value: () => pageId,
          writable: false,
        },
        startRecording: {
          configurable: false,
          enumerable: false,
          value: (params: object) =>
            new Promise((resolve, reject) => {
              if (!record) {
                throw new Error(
                  `Must connect with a record query-param set to "true" in order to use recording`,
                );
              }
              const start = () =>
                window.postMessage(
                  { ...params, id: pageId, type: 'REC_START' },
                  '*',
                );
              const onStart = (event: MessageEvent) => {
                if (event.data.id !== pageId) return;
                if (event.data.message === 'REC_STARTED') {
                  window.removeEventListener('message', onStart);
                  return resolve(undefined);
                }
                if (event.data.message === 'REC_START_FAIL') {
                  window.removeEventListener('message', onStart);
                  return reject(new Error(event.data.error));
                }
              };

              window.addEventListener('message', onStart);

              return document.readyState == 'complete'
                ? start()
                : window.addEventListener('load', start);
            }),
          writable: false,
        },
        stopRecording: {
          configurable: false,
          enumerable: false,
          value: () =>
            new Promise((resolve, reject) => {
              if (!record) {
                return reject(
                  new Error(
                    `Must connect with a record query-param set to "true" in order to use recording`,
                  ),
                );
              }
              const onStop = (event: MessageEvent) => {
                if (event.data.id !== pageId) return;
                if (event.data.message === 'REC_FILE') {
                  window.removeEventListener('message', onStop);
                  return resolve(event.data.file);
                }

                if (event.data.message === 'REC_STOP_FAIL') {
                  window.removeEventListener('message', onStop);
                  return reject(new Error(event.data.error));
                }

                if (event.data.message === 'REC_NOT_STARTED') {
                  window.removeEventListener('message', onStop);
                  return reject(
                    new Error(
                      `Recording hasn't started, did you forget to start it?`,
                    ),
                  );
                }
              };

              window.addEventListener('message', onStop);
              return window.postMessage({ id: pageId, type: 'REC_STOP' }, '*');
            }),
          writable: false,
        },
      });
    };

    // Setup the browserless embedded API
    await Promise.all([
      page.evaluate(embeddedAPI, pageId, liveUrl, record),
      page.evaluateOnNewDocument(embeddedAPI, pageId, liveUrl, record),
    ]).catch((err) =>
      this.debug(`Error setting up embedded API:`, err.message),
    );
  };

  public getPageId = (page: Page): string => {
    // @ts-ignore
    return page.target()._targetId;
  };

  public makeLiveURL = (browserId: string, pageId: string) => {
    const serverAddress = this.config.getExternalAddress();
    const key = this.config.getAESKey();
    const path = `${browserId}${liveURLSep}${pageId}`;
    const encoded = util.encrypt(path, key);
    const query = `?id=${encoded}`;

    return util.makeExternalURL(serverAddress, 'live', query);
  };

  private onTargetCreated = async (target: Target) => {
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
              page.close().catch(util.noop);
              this.close();
            }
          });

          page.on('response', async (response) => {
            if (response.url().startsWith('file://')) {
              this.debug(
                `File protocol request found in response, terminating`,
              );
              page.close().catch(util.noop);
              this.close();
            }
          });
        }
        const browserId = this.wsEndpoint()?.split('/').pop() as string;
        await this.setUpEmbeddedAPI(page, browserId, this.record);
        this.emit('newPage', page);
      }
    }
  };

  public isRunning = (): boolean => this.running;

  public newPage = async (): Promise<Page> => {
    if (!this.browser) {
      throw new util.ServerError(`Browser hasn't been launched yet!`);
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
      executablePath: playwright.chromium.executablePath(),
    };

    if (this.record || this.blockAds) {
      const requiredExtensionArgs: string[] = [];
      // Necessary to load extensions
      finalOptions.headless = false;

      if (this.record) {
        finalOptions.ignoreDefaultArgs = ['--enable-automation'];
        requiredExtensionArgs.push(
          '--enable-usermedia-screen-capturing',
          '--enable-blink-features=GetUserMedia',
          '--allow-http-screen-capture',
          '--auto-select-desktop-capture-source=browserless-screencast',
          '--disable-infobars',
        );
      }

      const loadExtensionPaths: string = [
        ...(this.record
          ? [path.join(__dirname, '..', '..', 'extensions', 'screencast')]
          : []),
        ...(this.blockAds
          ? [path.join(__dirname, '..', '..', 'extensions', 'ublock')]
          : []),
      ].join(',');

      finalOptions.args.push(
        ...requiredExtensionArgs,
        '--load-extension=' + loadExtensionPaths,
        '--disable-extensions-except=' + loadExtensionPaths,
      );
    }

    const launch = options.stealth
      ? puppeteerStealth.launch.bind(puppeteerStealth)
      : puppeteer.launch.bind(puppeteer);

    this.debug(finalOptions, `Launching CDP Chrome Handler`);
    this.browser = (await launch(finalOptions)) as Browser;
    this.browser.on('targetcreated', this.onTargetCreated);
    this.running = true;
    this.browserWSEndpoint = this.browser.wsEndpoint();
    this.debug(`Browser is running on ${this.browserWSEndpoint}`);

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

  public proxyPageWebSocket = async (
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> =>
    new Promise(async (resolve, reject) => {
      if (!this.browserWSEndpoint || !this.browser) {
        throw new util.ServerError(
          `No browserWSEndpoint found, did you launch first?`,
        );
      }
      socket.once('close', resolve);

      this.debug(
        `Proxying ${req.parsed.href} to browser ${this.browserWSEndpoint}`,
      );

      const [page] = await this.browser.pages();
      const pageLocation = `/devtools/page/${this.getPageId(page)}`;

      this.debug(`Proxying ${req.parsed.href} to page "${pageLocation}"`);

      req.url = pageLocation;

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

      const close = util.once(() => {
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
