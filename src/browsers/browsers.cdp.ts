import {
  BLESS_PAGE_IDENTIFIER,
  BrowserLauncherOptions,
  Config,
  Logger,
  Request,
  ServerError,
  chromeExecutablePath,
  edgeExecutablePath,
  findBlockedNavigationUrl,
  noop,
  once,
  toBlockedUrlPatterns,
  toBlockedUrlRules,
  ublockLitePath,
} from '@browserless.io/browserless';
import puppeteer, { Browser, CDPSession, Page, Target } from 'puppeteer-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import StealthPlugin from '@zorilla/puppeteer-extra-plugin-stealth';
import { addExtra } from '@zorilla/puppeteer-extra';
import getPort from 'get-port';
import httpProxy from 'http-proxy';
import path from 'path';
import playwright from 'playwright-core';

// @zorilla/puppeteer-extra's types still expect puppeteer's long-removed
// createBrowserFetcher and re-declare their own plugin interface; at runtime
// only launch/connect/defaultArgs/executablePath are used, so the casts are safe.
const puppeteerStealth = addExtra(
  puppeteer as unknown as Parameters<typeof addExtra>[0],
);
puppeteerStealth.use(
  StealthPlugin() as unknown as Parameters<typeof puppeteerStealth.use>[0],
);

/**
 * Chrome's component updater fetches into scratch directories under
 * `base::GetTempDir()` — the shared system temp dir, not the session's
 * user-data dir. A session on a fresh data dir finds no component cache and
 * re-downloads the whole set (CRLSet, Safe Browsing, Subresource Filter,
 * First-Party Sets, …), and that scratch is only unlinked by `ScopedTempDir`'s
 * destructor — which never runs when Chrome exits on SIGKILL, as it does
 * whenever `puppeteer.close()` escalates. The orphans land outside both
 * getDataDir() and getDownloadsDir(), so nothing reclaims them: a busy
 * deployment filled 125GB of /tmp in two hours this way.
 *
 * Applied unconditionally, including when a caller supplies its own
 * `userDataDir`. Component refresh is not something a session should be doing:
 * it spends bandwidth mid-run and makes the browser's behaviour vary between
 * otherwise identical automation runs. Updated component data reaches
 * deployments through a new browser build in a new image, which is the only
 * refresh channel that is reproducible. Persistent profiles are also the
 * longest-lived sessions, so exempting them would leak the most scratch.
 *
 * Not expressible through `--disable-features`; the updater is gated on this
 * top-level switch. Puppeteer's `defaultArgs` covers the sibling case
 * (`--disable-background-networking`) but not this one.
 */
export const disableComponentUpdaterArg = '--disable-component-update';

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
  protected keepUntilMS = 0;

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

    this.logger.debug(`Starting new ${this.constructor.name} instance`);
  }

  protected cleanListeners() {
    this.browser?.removeAllListeners();
    this.removeAllListeners();
  }

  public keepUntil() {
    return this.keepUntilMS;
  }

  public setKeepUntil(timeout: number) {
    this.keepUntilMS = timeout;
    return this.keepUntilMS;
  }

  public getPageId(page: Page): string {
    // @ts-ignore
    return page.target()._targetId;
  }

  /**
   * Stops the page from reaching a blocked destination, rather than reacting
   * once it already has. `page.on('request')` only observes: by the time it
   * fires the request is in flight, so the teardown it used to trigger cost
   * the customer their session without preventing anything.
   *
   * Blocking is `Network.setBlockedURLs`. The obvious alternative — pausing
   * requests with `Fetch` and asking {@link findBlockedNavigationUrl} for a
   * verdict — is what this replaced: enabling `Fetch` on a second CDP session
   * swallows the auth challenge for every request on the target, so a client's
   * `page.authenticate()` is never asked for credentials and the navigation
   * fails with `ERR_INVALID_AUTH_CREDENTIALS` (PLT-1596). That happens whether
   * or not any request matches our patterns, and `handleAuthRequests` is no
   * answer: we would then own challenges we have no credentials for.
   *
   * The patterns therefore carry the whole policy, self-origin exemption
   * included — see {@link toBlockedUrlPatterns}. What they cannot cover is
   * navigations and WebSocket handshakes, which `setBlockedURLs` does not
   * apply to (measured); those stay with the route-level 403, the
   * wire-protocol check, and the observational teardown below.
   *
   * The blocklist is read once per page rather than once per request, so a
   * config change reaches the next page rather than the next request; the
   * observational backstop below still re-reads it every time.
   *
   * Set on the session puppeteer already drives the page with, not a fresh
   * one: a second session has to `Target.attachToTarget` (which failed often
   * enough in production to leave pages unguarded) and would carry a second
   * copy of every `Network` event for the life of the page.
   */
  protected async installBlockedUrlGuard(page: Page): Promise<void> {
    const patterns = this.config.getBlockedURLPatterns();
    const ranges = this.config.getBlockedNetworkRanges();
    const selfHosts = this.config.getSelfNavigationHosts();
    const blockedUrls = toBlockedUrlPatterns(patterns, ranges, selfHosts);

    if (!blockedUrls.length) {
      return;
    }

    const session = await this.pageSession(page);

    if (!session) {
      return;
    }

    // `Network` is already enabled on puppeteer's own session — the page
    // events below depend on it — but the guard is inert without it, so say so
    // rather than inherit it. Both calls are idempotent.
    await session
      .send('Network.enable')
      .then(() => session.send('Network.setBlockedURLs', { urls: blockedUrls }))
      .then(async () => {
        const urlPatterns = toBlockedUrlRules(patterns, ranges, selfHosts);
        if (urlPatterns.length) {
          // Install the conservative list first. If an older browser rejects
          // ordered rules, that list stays active on this same session.
          await session
            .send('Network.setBlockedURLs', {
              urls: blockedUrls,
              urlPatterns,
            })
            .catch((err) => {
              this.logger.warn(`Using legacy blocked-URL patterns: ${err}`);
            });
        }
      })
      .catch((err) => {
        this.logger.error(`Could not enable the blocked-URL guard: ${err}`);
      });
  }

  /**
   * The CDP session puppeteer already drives `page` on. `Frame.client` is
   * public at runtime but absent from puppeteer's exported `Frame` type, so it
   * needs the cast; a puppeteer that drops it falls back to a session of our
   * own, which costs a duplicate event stream but still guards the page.
   */
  protected async pageSession(page: Page): Promise<CDPSession | null> {
    try {
      const client = (page.mainFrame() as unknown as { client?: CDPSession })
        .client;

      if (client) {
        return client;
      }
    } catch {
      // A page that closed between 'targetcreated' and here has no frame to
      // read it from; the attach below reports its own failure.
    }

    return page.createCDPSession().catch((err) => {
      this.logger.error(`Could not attach the blocked-URL guard: ${err}`);
      return null;
    });
  }

  protected async onTargetCreated(target: Target) {
    if (target.type() === 'page') {
      const page = await target.page().catch((e) => {
        this.logger.error(`Error in ${this.constructor.name} new page ${e}`);
        return null;
      });

      if (page) {
        this.logger.trace(`Setting up blocked-URL request blocking`);

        page.on('error', (err) => {
          this.logger.error(err);
        });

        page.on('pageerror', (err) => {
          this.logger.debug(err);
        });

        page.on('framenavigated', (frame) => {
          this.logger.trace(`Navigation to ${frame.url()}`);
        });

        page.on('console', (message) => {
          this.logger.trace(`${message.type()}: ${message.text()}`);
        });

        page.on('requestfailed', (req) => {
          // Chromium reports some failures with no error text at all —
          // `failure()` is null for a scheme it refused outright, such as a
          // `file://` sub-resource on an https page — so say that rather than
          // interpolating the string "undefined" into the log.
          const errorText = req.failure()?.errorText ?? 'no error text';
          this.logger.debug(`"${errorText}": ${req.url()}`);
        });

        // Observational backstop behind installBlockedUrlGuard, which has
        // already failed the request by the time these fire. A blocked URL
        // still surfacing here means the interception patterns missed it, so
        // the request did go out — tearing the session down would not unsend
        // it (measured: the request reaches the destination either way), and a
        // sub-resource does not justify killing an otherwise healthy session.
        // Third-party markup is full of local leftovers — Word-pasted
        // `file://` images, `http://localhost:8888` URLs baked into a migrated
        // WordPress site — and those used to end customer sessions.
        //
        // A navigation is the exception: it is the case the route handlers'
        // pre-navigation 403 cannot see (renderer-initiated `location.href`, a
        // meta refresh, a cross-scheme redirect), and it is the shape a
        // deliberate probe takes rather than someone else's stale markup.
        const onBlockedUrl = (
          url: string,
          direction: 'request' | 'response',
          isNavigation: boolean,
        ): void => {
          // Read config per call (it can change at runtime) but skip the
          // normalize/match work entirely in the common case where nothing is
          // configured to block — this runs for every request and response.
          const patterns = this.config.getBlockedURLPatterns();
          const ranges = this.config.getBlockedNetworkRanges();
          if (!patterns.length && !ranges) {
            return;
          }
          // Scheme blocklist (e.g. file://) plus the private-network
          // classifier. The server's own origin is exempt so this can't sever
          // browserless's own pages (e.g. the /function runtime, which loads
          // from the local server).
          const blocked = findBlockedNavigationUrl(
            url,
            patterns,
            ranges,
            this.config.getSelfNavigationHosts(),
          );
          if (!blocked) {
            return;
          }
          if (!isNavigation) {
            this.logger.warn(
              `Blocked URL "${blocked}" in ${direction} to ${this.constructor.name}, ignoring sub-resource`,
            );
            return;
          }
          this.logger.error(
            `Blocked URL "${blocked}" in ${direction} to ${this.constructor.name}, terminating`,
          );
          page.close().catch(noop);
          this.close();
        };

        page.on('request', async (request) => {
          this.logger.trace(`${request.method()}: ${request.url()}`);
          onBlockedUrl(request.url(), 'request', request.isNavigationRequest());
        });

        page.on('response', async (response) => {
          this.logger.trace(`${response.status()}: ${response.url()}`);
          onBlockedUrl(
            response.url(),
            'response',
            response.request().isNavigationRequest(),
          );
        });

        // Installed last, and deliberately: the handlers above are attached
        // synchronously, so nothing a page does in the round trips this takes
        // can slip past unobserved. Putting the install first left the backstop
        // blind to the first navigation of a page — long enough for a client to
        // read a file:// document before the teardown reached it.
        await this.installBlockedUrlGuard(page);

        this.emit('newPage', page);
      }
    }
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getConfig(): Config {
    return this.config;
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
      this.logger.debug(
        `Closing ${this.constructor.name} process and all listeners`,
      );
      this.emit('close');
      this.cleanListeners();
      this.browser.removeAllListeners();
      const browser = this.browser;
      this.running = false;
      this.browser = null;
      this.browserWSEndpoint = null;
      await browser.close().catch(() => undefined);
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
    this.logger.debug(`${this.constructor.name} got open port ${this.port}`);

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
        // Chrome 152's first-run UI prevents remote debugging from starting.
        // Keep launches non-interactive even with ignoreDefaultArgs: true.
        `--no-first-run`,
        // Playwright 1.57+ uses Chrome For Test, which has stricter security than Chromium.
        // This is needed to allow WebSocket connections to localhost.
        `--disable-features=LocalNetworkAccessChecks`,
        disableComponentUpdaterArg,
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

    this.logger.debug(
      finalOptions,
      `Launching ${this.constructor.name} Handler`,
    );
    this.browser = (await launch(finalOptions)) as Browser;
    this.browser.on('targetcreated', this.onTargetCreated.bind(this));
    // Propagate unexpected disconnect (Chrome OOM, segfault, host SIGKILL)
    // as a `close` event on the wrapper. Without this, a spontaneous
    // exit leaves the BrowserlessSession in BrowserManager.browsers
    // forever and the user-data-dir leaks. The `if (this.running)`
    // guard skips re-entry during the normal close() path (which sets
    // running=false before awaiting the inner close).
    this.browser.once('disconnected', () => {
      if (this.running) {
        this.logger.warn(
          `${this.constructor.name} disconnected unexpectedly, emitting close`,
        );
        this.emit('close');
        this.cleanListeners();
        // `?.` because `this.emit('close')` above recursively re-enters
        // wrapper.close() (via BrowserManager's close listener) and nulls
        // this.browser synchronously before control returns here.
        this.browser?.removeAllListeners();
        this.running = false;
        this.browser = null;
        this.browserWSEndpoint = null;
      }
    });
    this.running = true;
    this.browserWSEndpoint = this.browser.wsEndpoint();
    this.logger.debug(
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
    // Throws and rejections here (newPage failing, browser gone) must
    // propagate to the caller — inside a promise-executor they'd be
    // swallowed, the promise would never settle, and the browser would
    // never be released back to the manager.
    if (!this.browserWSEndpoint || !this.browser) {
      throw new ServerError(
        `No browserWSEndpoint found, did you launch first?`,
      );
    }

    this.logger.debug(
      `Proxying ${req.parsed.href} to ${this.constructor.name}`,
    );

    const shouldMakePage = req.parsed.pathname.includes(BLESS_PAGE_IDENTIFIER);
    const page = shouldMakePage ? await this.browser.newPage() : null;
    const pathname = page
      ? path.join('/devtools', '/page', this.getPageId(page))
      : req.parsed.pathname;
    const target = new URL(pathname, this.browserWSEndpoint).href;
    req.url = '';

    // Delete headers known to cause issues
    delete req.headers.origin;

    return new Promise((resolve, reject) => {
      // The page made for this connection lives only as long as the
      // client socket — without this, keep-alive browsers accumulate a
      // renderer per reconnect cycle.
      socket.once('close', () => {
        page?.close().catch(noop);
        resolve();
      });

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
          page?.close().catch(noop);
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

      this.logger.debug(
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
