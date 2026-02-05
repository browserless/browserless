import {
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessSession,
  BrowserlessSessionJSON,
  CDPJSONPayload,
  ChromeCDP,
  ChromiumCDP,
  Config,
  EdgeCDP,
  FileSystem,
  Hooks,
  Logger,
  NotFound,
  ReplayCompleteParams,
  Request,
  ServerError,
  SessionReplay,
  BrowserWebsocketRoute,
  availableBrowsers,
  isReplayCapable,
  makeExternalURL,
} from '@browserless.io/browserless';
import path from 'path';

import { SessionRegistry } from '../session/session-registry.js';
import { SessionLifecycleManager } from '../session/session-lifecycle-manager.js';
import { ReplayCoordinator } from '../session/replay-coordinator.js';
import { BrowserLauncher } from './browser-launcher.js';

/**
 * BrowserManager is a facade that coordinates browser session management.
 *
 * After refactoring, it delegates to specialized components:
 * - SessionRegistry: Map bookkeeping, session lookup
 * - SessionLifecycleManager: TTL timers, cleanup, close
 * - ReplayCoordinator: CDP protocol, rrweb injection
 * - BrowserLauncher: Launch logic, option parsing
 *
 * This class was reduced from 1270 lines to ~200 lines.
 */
export class BrowserManager {
  protected log = new Logger('browser-manager');
  protected chromeBrowsers = [ChromiumCDP, ChromeCDP, EdgeCDP];

  // Extracted components
  protected registry: SessionRegistry;
  protected lifecycle: SessionLifecycleManager;
  protected replay: ReplayCoordinator;
  protected launcher: BrowserLauncher;

  constructor(
    protected config: Config,
    protected hooks: Hooks,
    protected fileSystem: FileSystem,
    protected sessionReplay?: SessionReplay,
  ) {
    // Initialize extracted components
    this.registry = new SessionRegistry();
    this.replay = new ReplayCoordinator(sessionReplay);
    this.lifecycle = new SessionLifecycleManager(
      this.registry,
      this.replay,
    );
    this.launcher = new BrowserLauncher(
      config,
      hooks,
      this.registry,
      this.replay
    );
  }

  /**
   * Check if a browser is Chrome-like.
   */
  protected browserIsChrome(b: BrowserInstance): boolean {
    return this.launcher.browserIsChrome(b);
  }

  /**
   * Returns the /json/protocol API contents from Chromium or Chrome.
   */
  public async getProtocolJSON(logger: Logger): Promise<object> {
    const Browser = (await availableBrowsers).find((InstalledBrowser) =>
      this.chromeBrowsers.some(
        (ChromeBrowser) => InstalledBrowser === ChromeBrowser,
      ),
    );
    if (!Browser) {
      throw new Error(`No Chrome or Chromium browsers are installed!`);
    }
    const browser = new Browser({
      blockAds: false,
      config: this.config,
      logger,
      userDataDir: null,
    });
    await browser.launch({ options: {} });
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new Error('There was an error launching the browser');
    }

    const { port } = new URL(wsEndpoint);
    const res = await fetch(`http://127.0.0.1:${port}/json/protocol`);
    const protocolJSON = await res.json();

    browser.close();

    return protocolJSON;
  }

  /**
   * Returns the /json/version API from Chromium or Chrome.
   */
  public async getVersionJSON(logger: Logger): Promise<CDPJSONPayload> {
    this.log.debug(`Launching Chromium to generate /json/version results`);
    const Browser = (await availableBrowsers).find((InstalledBrowser) =>
      this.chromeBrowsers.some(
        (ChromeBrowser) => InstalledBrowser === ChromeBrowser,
      ),
    );

    if (!Browser) {
      throw new ServerError(`No Chrome or Chromium browsers are installed!`);
    }
    const browser = new Browser({
      blockAds: false,
      config: this.config,
      logger,
      userDataDir: null,
    });
    await browser.launch({ options: {} });
    const wsEndpoint = browser.wsEndpoint();

    if (!wsEndpoint) {
      throw new ServerError('There was an error launching the browser');
    }

    const { port } = new URL(wsEndpoint);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const meta = await res.json();

    browser.close();

    const { 'WebKit-Version': webkitVersion } = meta;
    const debuggerVersion = webkitVersion.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)[1];

    return {
      ...meta,
      'Debugger-Version': debuggerVersion,
      webSocketDebuggerUrl: this.config.getExternalWebSocketAddress(),
    };
  }

  /**
   * Returns a list of all Chrome-like browsers with their /json/list contents.
   */
  public async getJSONList(): Promise<Array<CDPJSONPayload>> {
    const externalAddress = this.config.getExternalWebSocketAddress();
    const externalURL = new URL(externalAddress);
    const sessions = this.registry.toArray();

    const cdpResponse = await Promise.all(
      sessions.map(async ([browser]) => {
        const isChromeLike = this.browserIsChrome(browser);
        const wsEndpoint = browser.wsEndpoint();
        if (isChromeLike && wsEndpoint) {
          const port = new URL(wsEndpoint).port;
          const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
            headers: {
              Host: '127.0.0.1',
            },
          });
          if (response.ok) {
            const cdpJSON: Array<CDPJSONPayload> = await response.json();
            return cdpJSON.map((c) => {
              const webSocketDebuggerURL = new URL(c.webSocketDebuggerUrl);
              const devtoolsFrontendURL = new URL(
                c.devtoolsFrontendUrl,
                externalAddress,
              );
              const wsQuery = devtoolsFrontendURL.searchParams.get('ws');

              if (wsQuery) {
                const paramName = externalURL.protocol.startsWith('wss')
                  ? 'wss'
                  : 'ws';
                devtoolsFrontendURL.searchParams.set(
                  paramName,
                  path.join(
                    webSocketDebuggerURL.host,
                    webSocketDebuggerURL.pathname,
                  ),
                );
              }

              webSocketDebuggerURL.host = externalURL.host;
              webSocketDebuggerURL.port = externalURL.port;
              webSocketDebuggerURL.protocol = externalURL.protocol;

              return {
                ...c,
                devtoolsFrontendUrl: devtoolsFrontendURL.href,
                webSocketDebuggerUrl: webSocketDebuggerURL.href,
              };
            });
          }
        }
        return null;
      }),
    );

    return cdpResponse
      .flat()
      .filter((_) => _ !== null) as Array<CDPJSONPayload>;
  }

  /**
   * Generate session JSON for a browser.
   */
  protected async generateSessionJson(
    browser: BrowserInstance,
    session: BrowserlessSession,
  ): Promise<BrowserlessSessionJSON[]> {
    const serverHTTPAddress = this.config.getExternalAddress();
    const serverWSAddress = this.config.getExternalWebSocketAddress();

    const sessions: BrowserlessSessionJSON[] = [
      {
        ...session,
        browser: browser.constructor.name,
        browserId: session.id,
        initialConnectURL: new URL(session.initialConnectURL, serverHTTPAddress)
          .href,
        killURL: session.id
          ? makeExternalURL(serverHTTPAddress, '/kill/', session.id)
          : null,
        running: browser.isRunning(),
        timeAliveMs: Date.now() - session.startedOn,
        type: 'browser',
      },
    ];

    const internalWSEndpoint = browser.wsEndpoint();
    const externalURI = new URL(serverHTTPAddress);
    const externalProtocol = externalURI.protocol === 'https:' ? 'wss' : 'ws';

    if (this.browserIsChrome(browser) && internalWSEndpoint) {
      const browserURI = new URL(internalWSEndpoint);
      const response = await fetch(
        `http://127.0.0.1:${browserURI.port}/json/list`,
        {
          headers: {
            Host: '127.0.0.1',
          },
        },
      );
      if (response.ok) {
        const body = await response.json();
        for (const page of body) {
          const pageURI = new URL(page.webSocketDebuggerUrl);
          const devtoolsFrontendUrl =
            `/devtools/inspector.html?${externalProtocol}=${externalURI.host}${externalURI.pathname}${pageURI.pathname}`.replace(
              /\/\//gi,
              '/',
            );

          const browserWSEndpoint = new URL(
            browserURI.pathname,
            serverWSAddress,
          ).href;

          const webSocketDebuggerUrl = new URL(
            pageURI.pathname,
            serverWSAddress,
          ).href;

          sessions.push({
            ...sessions[0],
            ...page,
            browserWSEndpoint,
            devtoolsFrontendUrl,
            webSocketDebuggerUrl,
          });
        }
      }
    }
    return sessions;
  }

  /**
   * Close a browser session.
   * Delegates to SessionLifecycleManager.
   */
  public async close(
    browser: BrowserInstance,
    session: BrowserlessSession,
    force = false,
  ): Promise<ReplayCompleteParams | null> {
    return this.lifecycle.close(browser, session, force);
  }

  /**
   * Kill sessions by ID, trackingId, or 'all'.
   * Delegates to SessionLifecycleManager.
   */
  public async killSessions(target: string): Promise<ReplayCompleteParams[]> {
    try {
      return await this.lifecycle.killSessions(target);
    } catch (e) {
      if (e instanceof Error && e.message.includes("Couldn't locate session")) {
        throw new NotFound(e.message);
      }
      throw e;
    }
  }

  /**
   * Get all sessions formatted as JSON.
   */
  public async getAllSessions(
    trackingId?: string,
  ): Promise<BrowserlessSessionJSON[]> {
    const sessions = this.registry.toArray();

    let formattedSessions: BrowserlessSessionJSON[] = [];
    for (const [browser, session] of sessions) {
      const formattedSession = await this.generateSessionJson(browser, session);
      formattedSessions.push(...formattedSession);
    }

    if (trackingId) {
      formattedSessions = formattedSessions.filter(
        (s) => s.trackingId && s.trackingId === trackingId,
      );
    }

    return formattedSessions;
  }

  /**
   * Complete a browser session (WebSocket disconnect).
   * Delegates to SessionLifecycleManager.
   */
  public async complete(browser: BrowserInstance): Promise<void> {
    return this.lifecycle.complete(browser);
  }

  /**
   * Get a browser for a request.
   * Delegates to BrowserLauncher.
   */
  public async getBrowserForRequest(
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
    logger: Logger,
  ): Promise<BrowserInstance> {
    const browser = await this.launcher.getBrowserForRequest(req, router, logger);

    // Set up replay event handlers for browsers that support it
    if (isReplayCapable(browser)) {
      // Ensure replayComplete can be emitted before client WS closes
      browser.setOnBeforeClose(async () => {
        await this.closeForBrowser(browser, true);
      });

      // Receive replay ACKs from client to gate close until delivery confirmed
      browser.setOnReplayAck((ackId) => {
        this.lifecycle.handleReplayAck(ackId);
      });
    }

    return browser;
  }

  /**
   * Close a browser session by instance (used for WS close interception).
   */
  public async closeForBrowser(
    browser: BrowserInstance,
    force = true,
  ): Promise<ReplayCompleteParams | null> {
    const session = this.registry.get(browser);
    if (!session) return null;
    return this.lifecycle.close(browser, session, force);
  }

  /**
   * Shutdown the browser manager.
   */
  public async shutdown(): Promise<void> {
    this.log.info(`Closing down browser instances`);
    await this.lifecycle.shutdown();
    this.registry.clear();
    this.stop();
    this.log.info(`Shutdown complete`);
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}

  // Expose internal components for advanced use cases
  public getRegistry(): SessionRegistry {
    return this.registry;
  }

  public getLifecycle(): SessionLifecycleManager {
    return this.lifecycle;
  }

  public getReplayCoordinator(): ReplayCoordinator {
    return this.replay;
  }

  public getLauncher(): BrowserLauncher {
    return this.launcher;
  }
}
