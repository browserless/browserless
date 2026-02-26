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
  replayExtensionPath,
  screenxyPatchPath,
  ublockLitePath,
} from '@browserless.io/browserless';
import type { TargetId } from '../shared/cloudflare-detection.js';
import puppeteer, { Browser, Page, Target } from 'puppeteer-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import getPort from 'get-port';
import httpProxy from 'http-proxy';
import fs from 'fs';
import path from 'path';
import playwright from 'playwright-core';
import puppeteerStealth from 'puppeteer-extra';

import { CDPProxy, ReplayCapableBrowser, ReplayCompleteParams, TabReplayCompleteParams } from '../cdp-proxy.js';
import { CloudflareSolver } from '../session/cloudflare-solver.js';
import type { CloudflareConfig } from '../shared/cloudflare-detection.js';
puppeteerStealth.use(StealthPlugin());

export class ChromiumCDP extends EventEmitter implements ReplayCapableBrowser {
  protected config: Config;
  protected userDataDir: string | null;
  protected blockAds: boolean;
  protected enableReplay: boolean;
  protected running = false;
  protected browser: Browser | null = null;
  protected browserWSEndpoint: string | null = null;
  protected port?: number;
  protected logger: Logger;
  protected proxy = httpProxy.createProxyServer();
  protected executablePath = playwright.chromium.executablePath();
  // Flag to track when WE are creating a page (vs external clients like pydoll)
  // When true, the next targetcreated event is from our newPage() call
  // When false, it's from an external client and we should NOT attach puppeteer
  protected pendingInternalPage = false;
  // CDP-aware proxy for injecting events before close
  protected cdpProxy: CDPProxy | null = null;
  protected onBeforeClose?: () => Promise<void>;
  protected keepUntilMS = 0;
  private cloudflareSolver?: CloudflareSolver;

  constructor({
    blockAds,
    config,
    enableReplay,
    userDataDir,
    logger,
  }: {
    blockAds: boolean;
    config: Config;
    enableReplay?: boolean;
    logger: Logger;
    userDataDir: ChromiumCDP['userDataDir'];
  }) {
    super();

    this.userDataDir = userDataDir;
    this.config = config;
    this.blockAds = blockAds;
    this.enableReplay = enableReplay ?? false;
    this.logger = logger;

    this.logger.info(`Starting new ${this.constructor.name} instance`);
  }

  protected cleanListeners() {
    this.browser?.removeAllListeners();
    this.removeAllListeners();
  }

  public setOnBeforeClose(handler: () => Promise<void>): void {
    this.onBeforeClose = handler;
  }

  public keepUntil() {
    return this.keepUntilMS;
  }

  public setKeepUntil(timeout: number) {
    this.keepUntilMS = timeout;
    return this.keepUntilMS;
  }

  public setCloudflareSolver(cloudflareSolver: CloudflareSolver): void {
    this.cloudflareSolver = cloudflareSolver;
  }

  private replayMarkerCallback?: (targetId: TargetId, tag: string, payload?: object) => void;
  private getTabCountCallback?: () => number;

  public setReplayMarkerCallback(fn: (targetId: TargetId, tag: string, payload?: object) => void): void {
    this.replayMarkerCallback = fn;
  }

  public setGetTabCount(fn: () => number): void {
    this.getTabCountCallback = fn;
    if (this.cdpProxy) {
      this.cdpProxy.setGetTabCount(fn);
    }
  }

  /**
   * Extract the internal target ID from a Puppeteer Target.
   * Puppeteer doesn't expose this publicly but we need it for CDP routing.
   */
  private getTargetId(target: Target): string {
    return (target as unknown as { _targetId: string })._targetId;
  }

  public getPageId(page: Page): string {
    return this.getTargetId(page.target());
  }

  protected async onTargetCreated(target: Target) {
    if (target.type() === 'page') {
      // CRITICAL: Only attach puppeteer to targets WE created via newPage()
      // External clients (pydoll, playwright, etc.) create targets via /json/new
      // and don't want puppeteer-stealth or our event handlers interfering.
      // Attaching to external targets causes CDP command conflicts and timeouts.
      if (!this.pendingInternalPage) {
        const targetId = this.getTargetId(target);
        this.logger.trace(`Skipping external target ${targetId} (created by external CDP client)`);
        return;
      }

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

    // Pre-register that the next target is internal (created by us, not external client)
    // This flag is checked by onTargetCreated to decide whether to attach puppeteer
    this.pendingInternalPage = true;

    const page = await this.browser.newPage();

    // Reset flag (page creation complete)
    this.pendingInternalPage = false;

    return page;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      this.logger.info(
        `Closing ${this.constructor.name} process and all listeners`,
      );
      this.emit('close');
      // Store reference before nulling
      const browser = this.browser;
      this.running = false;
      this.browser = null;
      this.browserWSEndpoint = null;
      // Close browser FIRST, then clean up listeners
      // This ensures the 'close' event fires while listeners are still attached
      try {
        await browser.close();
      } catch (e) {
        this.logger.warn(`Error closing browser: ${e}`);
      }
      // Clean up listeners AFTER browser is fully closed
      browser.removeAllListeners();
      this.cleanListeners();
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

    const noExt = process.env.DISABLE_EXTENSIONS === 'true';
    const noScreenxy = process.env.DISABLE_SCREENXY_EXT === 'true';
    const noReplayExt = process.env.DISABLE_REPLAY_EXT === 'true';
    const extensions = noExt ? [] : [
      this.blockAds ? ublockLitePath : null,
      noScreenxy ? null : screenxyPatchPath,
      (this.enableReplay && !noReplayExt) ? replayExtensionPath : null,
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

    // Enforce WebRTC leak prevention when proxy is active
    const hasProxy = options.args?.some((arg) => arg.includes('--proxy-server'));
    const hasWebRtcPolicy = options.args?.some((arg) => arg.includes('--force-webrtc-ip-handling-policy'));
    if (hasProxy && !hasWebRtcPolicy) {
      options.args!.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
    }

    const finalOptions = {
      ...options,
      args: [
        `--remote-debugging-port=${this.port}`,
        `--no-sandbox`,

        // ── Anti-detection: suppress automation signals ──────────────
        // Source: SeleniumBase UC mode — reduce fingerprint surface via
        // Chrome flags rather than detectable JS overrides.
        `--disable-blink-features=AutomationControlled`,
        `--simulate-outdated-no-au=Tue, 31 Dec 2099 23:59:59 GMT`,
        `--no-first-run`,
        `--no-default-browser-check`,
        `--homepage=about:blank`,
        `--no-pings`,
        `--password-store=basic`,

        // ── Disable features that leak automation fingerprint ────────
        `--disable-features=` + [
          'LocalNetworkAccessChecks',
          'UserAgentClientHint',
          'OptimizationHints',
          'OptimizationHintsFetching',
          'OptimizationTargetPrediction',
          'OptimizationGuideModelDownloading',
          'Translate',
          'ComponentUpdater',
          'DownloadBubble',
          'DownloadBubbleV2',
          'InsecureDownloadWarnings',
          'InterestFeedContentSuggestions',
          'PrivacySandboxSettings4',
          'SidePanelPinning',
          'Bluetooth',
          'WebBluetooth',
          'UnifiedWebBluetooth',
          'WebAuthentication',
          'PasskeyAuth',
        ].join(','),

        // ── WebGL normalization ──────────────────────────────────────
        // SwiftShader produces a consistent WebGL fingerprint in Docker/Xvfb
        // where GPU access is unavailable anyway.
        `--use-gl=angle`,
        `--use-angle=swiftshader-webgl`,

        // ── Background throttling prevention ─────────────────────────
        `--disable-background-timer-throttling`,
        `--disable-backgrounding-occluded-windows`,
        `--disable-renderer-backgrounding`,

        // ── UI noise suppression ─────────────────────────────────────
        `--disable-infobars`,
        `--disable-notifications`,
        `--deny-permission-prompts`,
        `--disable-popup-blocking`,
        `--disable-search-engine-choice-screen`,
        `--disable-translate`,
        `--disable-save-password-bubble`,
        `--disable-single-click-autofill`,
        `--disable-client-side-phishing-detection`,
        `--disable-device-discovery-notifications`,
        `--ash-no-nudges`,

        // ── Performance / IPC ────────────────────────────────────────
        `--animation-duration-scale=0`,
        `--wm-window-animations-disabled`,
        `--disable-ipc-flooding-protection`,
        `--dns-prefetch-disable`,

        // ── Privacy Sandbox ──────────────────────────────────────────
        // Real Chrome has these APIs; enabling makes us look less like automation.
        `--enable-privacy-sandbox-ads-apis`,

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

    // ── Write Chrome Preferences before launch ──────────────────────
    // Suppresses credential prompts, notifications, safe browsing noise,
    // and the "Chrome didn't shut down correctly" crash banner.
    if (this.userDataDir) {
      const prefsDir = path.join(this.userDataDir, 'Default');
      const prefsPath = path.join(prefsDir, 'Preferences');
      try {
        fs.mkdirSync(prefsDir, { recursive: true });
        const prefs = {
          credentials_enable_service: false,
          autofill: { credit_card_enabled: false },
          profile: {
            password_manager_enabled: false,
            password_manager_leak_detection: false,
            exit_type: null,
            default_content_setting_values: { notifications: 2 },
          },
          local_discovery: { notifications_enabled: false },
          safebrowsing: { enabled: false, disable_download_protection: true },
        };
        fs.writeFileSync(prefsPath, JSON.stringify(prefs));
      } catch (err) {
        this.logger.warn(`Failed to write Chrome Preferences: ${err}`);
      }
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
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Proxy disconnect for PAGE session to ${this.constructor.name}: ${msg}`,
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
    if (!this.browserWSEndpoint) {
      throw new ServerError(
        `No browserWSEndpoint found, did you launch first?`,
      );
    }

    this.logger.info(
      `Proxying ${req.parsed.href} to ${this.constructor.name} ${this.browserWSEndpoint}`,
    );

    return new Promise(async (resolve, reject) => {
      const close = once(() => {
        this.logger.debug(
          `proxyWebSocket close triggered: browser=${!!this.browser} cdpProxy=${!!this.cdpProxy}`,
        );
        this.browser?.off('close', close);
        this.browser?.process()?.off('close', close);
        socket.off('close', close);
        socket.off('end', close);
        socket.off('error', close);
        this.cdpProxy = null;
        return resolve();
      });

      this.browser?.once('close', close);
      this.browser?.process()?.once('close', close);
      socket.once('close', close);
      socket.once('end', close);
      socket.once('error', close);

      try {
        // Create CDP-aware proxy for event injection
        this.cdpProxy = new CDPProxy(
          socket,
          head,
          req,
          this.browserWSEndpoint!,
          this.config,
          close,
          this.onBeforeClose,
          this.cloudflareSolver
            ? (config: CloudflareConfig) => this.cloudflareSolver!.enable(config)
            : undefined,
          this.replayMarkerCallback,
        );

        await this.cdpProxy.connect();
        this.logger.trace('CDPProxy connected successfully');

        // Wire tab count callback for tab limit enforcement
        if (this.getTabCountCallback) {
          this.cdpProxy.setGetTabCount(this.getTabCountCallback);
        }

        // Wire solver to CDPProxy for event emission
        if (this.cloudflareSolver && this.cdpProxy) {
          this.cloudflareSolver.setEmitClientEvent(
            (method: string, params: object) => this.cdpProxy!.emitClientEvent(method, params),
          );
          // Route solver's Input events through CDPProxy's browser WS
          this.cloudflareSolver.setSendViaProxy(
            (method, params, sessionId, timeoutMs) =>
              this.cdpProxy!.sendViaBrowserWs(method, params || {}, sessionId, timeoutMs),
          );
        }
      } catch (error) {
        this.logger.error(
          `Error proxying session to ${this.constructor.name}: ${error}`,
        );
        this.cdpProxy = null;
        this.close();
        return reject(error);
      }
    });
  }

  /**
   * Send replay metadata to client via CDP event.
   *
   * Called by SessionLifecycleManager before closing the session.
   * The client (Pydoll) can listen for "Browserless.replayComplete" event
   * to receive replay URL without making an additional HTTP call.
   */
  public async sendReplayComplete(
    metadata: ReplayCompleteParams,
  ): Promise<boolean> {
    if (this.cdpProxy) {
      await this.cdpProxy.sendReplayComplete(metadata);
      return true;
    } else {
      this.logger.warn('Cannot send replay complete: no CDPProxy available');
      return false;
    }
  }

  public async sendTabReplayComplete(
    metadata: TabReplayCompleteParams,
  ): Promise<boolean> {
    if (this.cdpProxy) {
      await this.cdpProxy.sendTabReplayComplete(metadata);
      return true;
    } else {
      this.logger.warn('Cannot send tab replay complete: no CDPProxy available');
      return false;
    }
  }
}

export class ChromeCDP extends ChromiumCDP {
  protected executablePath = chromeExecutablePath();
}

export class EdgeCDP extends ChromiumCDP {
  protected executablePath = edgeExecutablePath();
}
