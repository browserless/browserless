import {
  BrowserLauncherOptions,
  BrowserServerOptions,
  Config,
  Logger,
  Request,
  ServerError,
  chromeExecutablePath,
  edgeExecutablePath,
  findBlockedNavigationInMessage,
  findBlockedUrlInMessage,
  wsFrameToString,
} from '@browserless.io/browserless';
import { WebSocket, WebSocketServer } from 'ws';
import playwright, { Page } from 'playwright-core';
import { Duplex } from 'stream';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import path from 'path';

enum PlaywrightBrowserTypes {
  chromium = 'chromium',
  firefox = 'firefox',
  webkit = 'webkit',
}

/**
 * Chromium features Playwright disables by default, mirrored per supported
 * Playwright version. browserless can launch any of several pinned Playwright
 * versions (see `Config.loadPwVersion` / the `playwrightVersions` map in
 * package.json), and their `chromiumSwitches` `disabledFeatures` lists differ
 * slightly between versions.
 *
 * Why browserless re-declares them: `--disable-features` is a single-valued
 * Chromium switch. When it appears more than once on the command line, Chrome
 * keeps ONLY the last occurrence — the values are not unioned. Playwright emits
 * its `--disable-features=<list>` first and appends caller args after it, so the
 * flag browserless adds is the one Chrome keeps. If that flag does not itself
 * carry Playwright's list, every feature Playwright disables (e.g. RenderDocument)
 * is silently re-enabled.
 * See https://github.com/browserless/browserless/issues/5450
 *
 * These lists MUST stay 1:1 with the installed Playwright versions. The drift
 * test in browsers.playwright.spec.ts launches each pinned version and fails if
 * any adds or removes a feature relative to the mirror for that version.
 *
 * This is the default list — what the pinned `playwright-core` emits (currently
 * 1.61, and identical for 1.60). Versions whose list differs are overridden in
 * {@link playwrightChromiumDisabledFeaturesByVersion}.
 */
export const playwrightChromiumDisabledFeatures: readonly string[] = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'Translate',
  'AutoDeElevate',
  'RenderDocument',
  'OptimizationHints',
  'msForceBrowserSignIn',
  'msEdgeUpdateLaunchServicesPreferredVersion',
];

// 1.58 and 1.59 match the default except the ms*/Edge features, which Playwright
// began disabling in 1.60.
const playwright158And159DisabledFeatures: readonly string[] = [
  'AvoidUnnecessaryBeforeUnloadCheckSync',
  'BoundaryEventDispatchTracksNodeRemoval',
  'DestroyProfileOnBrowserClose',
  'DialMediaRouteProvider',
  'GlobalMediaControls',
  'HttpsUpgrades',
  'LensOverlay',
  'MediaRouter',
  'PaintHolding',
  'ThirdPartyStoragePartitioning',
  'Translate',
  'AutoDeElevate',
  'RenderDocument',
  'OptimizationHints',
];

/**
 * Per-version overrides for Playwright versions whose `disabledFeatures` list
 * differs from {@link playwrightChromiumDisabledFeatures}. Keyed by the
 * major.minor `pwVersion` (see `pwVersionRegex`). Versions not listed here
 * (e.g. '1.60', '1.61', 'default') use the default list.
 */
export const playwrightChromiumDisabledFeaturesByVersion: Readonly<
  Record<string, readonly string[]>
> = {
  // 1.57 still disables AcceptCHFrame (crbug.com/1348106) and does not yet
  // disable BoundaryEventDispatchTracksNodeRemoval or the ms*/Edge features.
  '1.57': [
    'AcceptCHFrame',
    'AvoidUnnecessaryBeforeUnloadCheckSync',
    'DestroyProfileOnBrowserClose',
    'DialMediaRouteProvider',
    'GlobalMediaControls',
    'HttpsUpgrades',
    'LensOverlay',
    'MediaRouter',
    'PaintHolding',
    'ThirdPartyStoragePartitioning',
    'Translate',
    'AutoDeElevate',
    'RenderDocument',
    'OptimizationHints',
  ],
  '1.58': playwright158And159DisabledFeatures,
  '1.59': playwright158And159DisabledFeatures,
};

/**
 * Resolve the disabled-features mirror for a `pwVersion` key ('1.57', '1.61',
 * 'default', …). Falls back to the default list for current/unknown versions.
 */
export const chromiumDisabledFeaturesForPwVersion = (
  pwVersion?: string,
): readonly string[] =>
  (pwVersion && playwrightChromiumDisabledFeaturesByVersion[pwVersion]) ||
  playwrightChromiumDisabledFeatures;

/**
 * Features browserless disables on top of Playwright's defaults. Chrome For Test
 * (used by Playwright 1.57+) enforces Local Network Access checks that block
 * WebSocket connections to localhost, which browserless relies on.
 * See https://github.com/browserless/browserless/issues/5450
 */
export const browserlessChromiumDisabledFeatures: readonly string[] = [
  'LocalNetworkAccessChecks',
];

const DISABLE_FEATURES_FLAG = '--disable-features';

/**
 * Extract every comma-joined value across all `--disable-features=` tokens in
 * `args` (e.g. `['--disable-features=A,B', '--disable-features=C']` -> `['A','B','C']`).
 */
export const parseDisableFeatures = (args: readonly string[]): string[] =>
  args
    .filter((arg) => arg.startsWith(`${DISABLE_FEATURES_FLAG}=`))
    .flatMap((arg) => arg.slice(arg.indexOf('=') + 1).split(','))
    .map((feature) => feature.trim())
    .filter(Boolean);

/**
 * Collapse every `--disable-features` token in `args` into a single trailing
 * flag holding the union of the launched Playwright version's defaults,
 * browserless's additions, and any caller-supplied features. The merged flag is
 * appended last so it is the `--disable-features` occurrence Chromium keeps (see
 * the note on {@link playwrightChromiumDisabledFeatures}).
 */
export const withMergedChromiumDisableFeatures = (
  args: readonly string[],
  pwVersion?: string,
): string[] => {
  const merged = [
    ...new Set([
      ...chromiumDisabledFeaturesForPwVersion(pwVersion),
      ...browserlessChromiumDisabledFeatures,
      ...parseDisableFeatures(args),
    ]),
  ];
  return [
    ...args.filter((arg) => !arg.startsWith(`${DISABLE_FEATURES_FLAG}=`)),
    `${DISABLE_FEATURES_FLAG}=${merged.join(',')}`,
  ];
};

class BasePlaywright extends EventEmitter {
  protected config: Config;
  protected userDataDir: string | null;
  protected running = false;
  protected logger: Logger;
  protected socket: Duplex | null = null;
  protected browser: playwright.BrowserServer | null = null;
  protected browserWSEndpoint: string | null = null;
  protected playwrightBrowserType: PlaywrightBrowserTypes =
    PlaywrightBrowserTypes.chromium;
  protected executablePath = () =>
    playwright[this.playwrightBrowserType].executablePath();
  protected async resolveExecutablePath(pwVersion: string): Promise<string> {
    return this.config.resolveExecutablePath(
      this.playwrightBrowserType,
      pwVersion,
    );
  }
  protected keepUntilMS = 0;

  // One shared WebSocketServer for upgrade handling. `noServer: true` means
  // it never owns an HTTP server — it only does the upgrade dance when we
  // call `handleUpgrade` from `proxyWebSocket`.
  private static wsServer = new WebSocketServer({ noServer: true });

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

    this.logger.debug(`Starting new ${this.constructor.name} instance`);
  }

  protected cleanListeners() {
    this.removeAllListeners();
  }

  protected makeLaunchOptions(opts: BrowserServerOptions, pwVersion?: string) {
    // Strip headless=old as it'll cause issues with newer Chromium
    const args = (opts.args ?? []).filter((a) => !a.includes('--headless=old'));
    const hasHeadless =
      args.some((a) => a.startsWith('--headless')) ||
      opts.headless !== undefined; // check for undefinity, since it can be set to false as well

    if (!hasHeadless) {
      args.push('--headless=new');
    }

    return {
      ...opts,
      args: [
        // Merge browserless's required toggles into a single --disable-features
        // flag. Chromium keeps only the LAST --disable-features on the command
        // line, so a standalone flag would clobber the list the launched
        // Playwright version passes, re-enabling features it disables (e.g.
        // RenderDocument). The list is version-specific, hence pwVersion.
        // See https://github.com/browserless/browserless/issues/5450
        ...withMergedChromiumDisableFeatures(args, pwVersion),
        this.userDataDir ? `--user-data-dir=${this.userDataDir}` : '',
      ],
      executablePath: this.executablePath(),
    };
  }

  public keepUntil() {
    return this.keepUntilMS;
  }

  public setKeepUntil(timeout: number) {
    this.keepUntilMS = timeout;
    return this.keepUntilMS;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getConfig(): Config {
    return this.config;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      this.logger.debug(
        `Closing ${this.constructor.name} process and all listeners`,
      );
      this.socket?.destroy();
      this.emit('close');
      this.cleanListeners();
      const browser = this.browser;
      this.running = false;
      this.browser = null;
      this.browserWSEndpoint = null;
      await browser.close().catch(() => undefined);
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
    const browser = await playwright[this.playwrightBrowserType].connect(
      this.browserWSEndpoint,
    );
    return await browser.newPage();
  }

  public async launch(
    launcherOpts: BrowserLauncherOptions,
  ): Promise<playwright.BrowserServer> {
    const { options, pwVersion } = launcherOpts;
    this.logger.debug(`Launching ${this.constructor.name} Handler`);

    const versionedPw = await this.config.loadPwVersion(pwVersion!);
    const opts = this.makeLaunchOptions(options, pwVersion);
    const executablePath = await this.resolveExecutablePath(pwVersion!);
    const browser = await versionedPw[this.playwrightBrowserType].launchServer({
      ...opts,
      executablePath,
      args: opts.args.filter((_) => !!_),
    });
    const browserWSEndpoint = browser.wsEndpoint();

    this.logger.debug(
      `${this.constructor.name} is running on ${browserWSEndpoint}`,
    );
    this.running = true;
    this.browserWSEndpoint = browserWSEndpoint;
    this.browser = browser;

    // Mirror ChromiumCDP: propagate unexpected playwright server exit
    // as a wrapper-level `close` so BrowserManager can clean up the
    // session and its user-data-dir. Guard against re-entry from the
    // normal close() path.
    browser.once('close', () => {
      if (this.running) {
        this.logger.warn(
          `${this.constructor.name} closed unexpectedly, emitting close`,
        );
        this.socket?.destroy();
        this.emit('close');
        this.cleanListeners();
        this.running = false;
        this.browser = null;
        this.browserWSEndpoint = null;
      }
    });

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

  /**
   * Frame-aware bidirectional WS forwarder. Inspects every Playwright
   * JSON-RPC frame and rejects messages — in either direction — whose
   * navigation URL matches `Config.getBlockedURLPatterns()`. Playwright's
   * `launchServer()` exposes only a raw WS pipe, so unlike CDP there's
   * no `Page` object to attach `request`/`response` listeners to.
   */
  public async proxyWebSocket(
    req: Request,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    this.socket = socket;
    return new Promise((resolve, reject) => {
      if (!this.browserWSEndpoint) {
        throw new ServerError(
          `No browserWSEndpoint found, did you launch first?`,
        );
      }
      this.logger.debug(
        `Proxying ${req.parsed.href} to ${this.constructor.name} ${this.browserWSEndpoint}`,
      );

      // Drops the client's `Origin` (localhost upstream would otherwise
      // reject it) and any negotiated subprotocol/extensions; `launchServer()`
      // negotiates neither, matching the prior `http-proxy.ws()` behavior.
      delete req.headers.origin;

      const safeClose = (ws?: { close: () => void }) => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      // `ws.handleUpgrade` silently drops the callback on a malformed
      // upgrade (e.g. bad `Sec-WebSocket-Key`). Without a socket-level
      // backstop the Promise would hang, pinning the concurrency slot.
      let settled = false;
      let clientWS: WebSocket | undefined;
      let upstreamWS: WebSocket | undefined;
      // Drops the bridge listeners (and the frame buffers their closures
      // retain) at teardown instead of waiting for GC — under reconnect
      // churn that retention adds up. A noop 'error' listener stays on so
      // a late ECONNRESET during the closing handshake can't become an
      // uncaught exception.
      const detachBridgeListeners = (ws?: WebSocket) => {
        if (!ws) return;
        ws.removeAllListeners('message');
        ws.removeAllListeners('open');
        ws.removeAllListeners('close');
        ws.removeAllListeners('error');
        ws.on('error', () => {});
      };
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        safeClose(clientWS);
        safeClose(upstreamWS);
        detachBridgeListeners(clientWS);
        detachBridgeListeners(upstreamWS);
        if (err) reject(err);
        else resolve();
      };
      // Routine TCP RSTs from clients land here as `'error'` ahead of
      // the upstream-handler chain. Resolve rather than reject so a
      // disconnected client isn't treated as a server fault. Aborted
      // upgrades still surface via the paired `'close'` backstop.
      socket.once('close', () => finish());
      socket.once('error', () => finish());

      BasePlaywright.wsServer.handleUpgrade(
        req as unknown as IncomingMessage,
        socket,
        head,
        (ws) => {
          clientWS = ws;
          try {
            upstreamWS = new WebSocket(this.browserWSEndpoint!);
          } catch (err) {
            this.logger.error(
              {
                err: (err as Error).message,
                browserWSEndpoint: this.browserWSEndpoint,
                href: req.parsed.href,
              },
              `${this.constructor.name} bridge setup failed`,
            );
            safeClose(ws);
            finish(err as Error);
            return;
          }

          // Let the close frame flush before destroying the socket. The
          // synchronous `this.close()` would otherwise abort TCP before
          // `ws.close(code, reason)` finished writing, leaving the client
          // with a `1006` instead of the policy code + reason.
          const DRAIN_TIMEOUT_MS = 500;
          const blockAndTerminate = (
            reason: string,
            closeCode = 1008,
            severity: 'error' | 'warn' = 'error',
          ) => {
            this.logger[severity](reason);
            let drained = false;
            const drain = () => {
              if (drained) return;
              drained = true;
              safeClose(upstreamWS);
              this.close();
              finish();
            };
            ws.once('close', drain);
            try {
              ws.close(closeCode, reason.slice(0, 123));
            } catch {
              drain();
              return;
            }
            setTimeout(drain, DRAIN_TIMEOUT_MS).unref?.();
          };

          // Cap the pre-`open` buffer to fend off a flood-during-connect
          // from a misbehaving client; 256 is well above any legitimate
          // handshake burst.
          const MAX_PENDING_FRAMES = 256;
          const pending: {
            data: Buffer | ArrayBuffer | Buffer[];
            isBinary: boolean;
          }[] = [];
          let upstreamReady = false;
          upstreamWS.once('open', () => {
            upstreamReady = true;
            for (const m of pending)
              upstreamWS!.send(m.data, { binary: m.isBinary });
            pending.length = 0;
          });

          // Snapshot patterns at upgrade time — mid-session reconfig
          // isn't a goal and re-evaluating per frame would churn the GC
          // on hot paths (DOM snapshots, base64 payloads).
          const blockPatterns = this.config.getBlockedURLPatterns();
          const stems = blockPatterns
            .map((p) => p.split(':')[0].toLowerCase())
            .filter((s) => s.length > 0);
          // Opt-in private-network ranges (null = disabled). Scheme blocking
          // stays in `blockPatterns` above. Unlike the CDP page-event guard —
          // which sees every request/response URL — the range check here is
          // scoped to explicit navigation frames (see findBlockedNavigationInMessage)
          // so it cannot over-block non-navigation frames that carry a `url`
          // (cookies, routes). The trade-off: a server-initiated redirect to a
          // private host (a request event, not a `goto`) is not caught on this
          // path; explicit navigations are.
          const blockRanges = this.config.getBlockedNetworkRanges();

          // Parse before matching — a raw-substring fast-path would miss
          // JSON Unicode escapes (`"file://..."` has no literal
          // `file` byte) that the upstream Playwright server's
          // `JSON.parse` would decode and act on.
          const inspectInner = (
            data: Buffer | ArrayBuffer | Buffer[],
            direction: 'client→upstream' | 'upstream→client',
            isBinary: boolean,
          ): string | null => {
            if (blockPatterns.length === 0 && !blockRanges) return null;
            const str = wsFrameToString(data);
            let parsed: unknown;
            try {
              parsed = JSON.parse(str);
            } catch {
              // Fail closed on unparseable *text* frames that bear a
              // blocked stem — strict-JSON divergence between bridge
              // and upstream would be a bypass. Binary frames are
              // exempt so a benign blob containing a `file` byte run
              // (e.g. a profile filename) doesn't tear down the
              // session. The exemption assumes the upstream parses
              // frames with `JSON.parse` like ours does — a future
              // upstream that acts on unparseable binary frames would
              // re-open this hole.
              if (isBinary) return null;
              const lower = str.toLowerCase();
              if (stems.some((s) => lower.includes(s))) {
                return `unparseable frame containing blocked stem in ${this.constructor.name} ${direction}`;
              }
              return null;
            }
            const hit = findBlockedUrlInMessage(parsed, blockPatterns);
            if (hit) {
              return `Blocked URL pattern "${hit}" in ${this.constructor.name} ${direction} message`;
            }
            const navHit = findBlockedNavigationInMessage(parsed, blockRanges);
            if (navHit) {
              return `Blocked navigation to "${navHit}" in ${this.constructor.name} ${direction} message`;
            }
            return null;
          };

          // Wrap the inspector so any unexpected throw (e.g. a malformed
          // payload that breaks `wsFrameToString` on a future ws version)
          // becomes a block reason instead of escaping through the
          // emitter and forwarding an uninspected frame.
          const inspect = (
            data: Buffer | ArrayBuffer | Buffer[],
            direction: 'client→upstream' | 'upstream→client',
            isBinary: boolean,
          ): string | null => {
            try {
              return inspectInner(data, direction, isBinary);
            } catch (err) {
              return `inspect failed in ${this.constructor.name} ${direction}, failing closed: ${(err as Error).message}`;
            }
          };

          ws.on('message', (data, isBinary) => {
            const hit = inspect(data, 'client→upstream', isBinary);
            if (hit) {
              blockAndTerminate(hit);
              return;
            }
            if (upstreamReady) {
              upstreamWS!.send(data, { binary: isBinary });
            } else {
              if (pending.length >= MAX_PENDING_FRAMES) {
                // Close-code 1009 = flow-control overflow (not a
                // policy block); warn keeps it distinct from the
                // security-block error stream.
                blockAndTerminate(
                  `Pre-open pending buffer overflowed (${MAX_PENDING_FRAMES} frames) in ${this.constructor.name}`,
                  1009,
                  'warn',
                );
                return;
              }
              pending.push({ data, isBinary });
            }
          });

          // Catches indirect navigations the renderer made on its own —
          // e.g. JS-side `fetch('file://...')` after a legitimate goto.
          upstreamWS.on('message', (data, isBinary) => {
            const hit = inspect(data, 'upstream→client', isBinary);
            if (hit) {
              blockAndTerminate(hit);
              return;
            }
            try {
              ws.send(data, { binary: isBinary });
            } catch (err) {
              // Surface a dead-client pipe instead of pumping upstream
              // into a black hole until some other event tears down.
              this.logger.error(
                `${this.constructor.name} client WS send failed: ${(err as Error).message}`,
              );
              finish();
            }
          });

          ws.on('close', () => finish());
          upstreamWS.on('close', () => finish());
          ws.on('error', (err) => {
            // Routine client disconnects (TCP RST) emit `'error'` here;
            // resolve so they don't surface as server faults.
            this.logger.debug(
              `${this.constructor.name} client WS error (treating as disconnect): ${err}`,
            );
            finish();
          });
          upstreamWS.on('error', (err) => {
            const e = err as NodeJS.ErrnoException;
            this.logger.error(
              {
                err: e.message,
                code: e.code,
                browserWSEndpoint: this.browserWSEndpoint,
                href: req.parsed.href,
              },
              `${this.constructor.name} upstream WS error`,
            );
            this.close();
            finish(err as Error);
          });
        },
      );
    });
  }
}

export class ChromiumPlaywright extends BasePlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.chromium;
}

export class ChromePlaywright extends ChromiumPlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.chromium;

  protected async resolveExecutablePath(): Promise<string> {
    return chromeExecutablePath();
  }
}

export class EdgePlaywright extends ChromiumPlaywright {
  protected playwrightBrowserType = PlaywrightBrowserTypes.chromium;

  protected async resolveExecutablePath(): Promise<string> {
    return edgeExecutablePath();
  }
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
