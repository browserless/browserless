import { mkdir } from 'fs/promises';
import path, { join } from 'path';

import { deleteAsync } from 'del';

import { Config } from '../config.js';
import { browserHook, pageHook } from '../hooks.js';
import { Request, HTTPManagementRoutes } from '../http.js';
import {
  BrowserHTTPRoute,
  BrowserInstance,
  BrowserlessSession,
  BrowserlessSessionJSON,
  BrowserServerOptions,
  BrowserWebsocketRoute,
  CDPLaunchOptions,
} from '../types.js';

import * as util from '../utils.js';

import { CDPChromium } from './cdp-chromium.js';

const debug = util.createLogger('browser-manager');

export class BrowserManager {
  private browsers: Map<BrowserInstance, BrowserlessSession> = new Map();
  private launching: Map<string, Promise<unknown>> = new Map();
  private timers: Map<string, number> = new Map();

  constructor(private config: Config) {}

  private removeUserDataDir = async (userDataDir: string | null) => {
    if (userDataDir && (await util.exists(userDataDir))) {
      debug(`Deleting data directory "${userDataDir}"`);
      await deleteAsync(userDataDir, { force: true }).catch((err) => {
        debug(`Error cleaning up user-data-dir "${err}" at ${userDataDir}`);
      });
    }
  };

  /**
   * Generates a directory for the user-data-dir contents to be saved in. Uses
   * the provided sessionId, or creates one when omitted,
   * and appends it to the name of the directory. If the
   * directory already exists then no action is taken, verified by run `stat`
   *
   * @param sessionId The ID of the session
   * @returns Promise<string> of the fully-qualified path of the directory
   */
  private generateDataDir = async (
    sessionId: string = util.id(),
  ): Promise<string> => {
    const baseDirectory = await this.config.getDataDir();
    const dataDirPath = join(
      baseDirectory,
      `browserless-data-dir-${sessionId}`,
    );

    if (await util.exists(dataDirPath)) {
      debug(`Data directory already exists, not creating "${dataDirPath}"`);
      return dataDirPath;
    }

    debug(`Generating user-data-dir at ${dataDirPath}`);

    await mkdir(dataDirPath, { recursive: true }).catch((err) => {
      throw new util.ServerError(
        `Error creating data-directory "${dataDirPath}": ${err}`,
      );
    });

    return dataDirPath;
  };

  private generateSessionJson = (
    browser: BrowserInstance,
    session: BrowserlessSession,
  ) => {
    const serverAddress = this.config.getExternalAddress();

    return {
      ...session,
      browser: browser.constructor.name,
      browserId: browser.wsEndpoint()?.split('/').pop(),
      initialConnectURL: new URL(session.initialConnectURL, serverAddress).href,
      killURL: session.id
        ? util.makeExternalURL(
            serverAddress,
            HTTPManagementRoutes.sessions,
            session.id,
          )
        : null,
      running: browser.isRunning(),
      timeAliveMs: Date.now() - session.startedOn,
    };
  };

  public close = async (
    browser: BrowserInstance,
    session: BrowserlessSession,
  ): Promise<void> => {
    const cleanupACtions: Array<() => Promise<void>> = [];
    debug(`${session.numbConnected} Client(s) are currently connected`);

    debug(`Closing browser session`);
    cleanupACtions.push(() => browser.close());

    if (session.isTempDataDir) {
      debug(
        `Deleting "${session.userDataDir}" user-data-dir and session from memory`,
      );
      this.browsers.delete(browser);
      cleanupACtions.push(() => this.removeUserDataDir(session.userDataDir));
    }

    await Promise.all(cleanupACtions.map((a) => a()));
  };

  public getAllSessions = async (): Promise<BrowserlessSessionJSON[]> => {
    const sessions = Array.from(this.browsers);

    return sessions.map(([browser, session]) =>
      this.generateSessionJson(browser, session),
    );
  };

  public complete = async (browser: BrowserInstance): Promise<void> => {
    const session = this.browsers.get(browser);
    if (!session) {
      debug(`Couldn't locate session for browser, proceeding with close`);
      return browser.close();
    }

    const { id, resolver } = session;

    if (id && resolver) {
      resolver(null);
      this.launching.delete(id);
    }

    --session.numbConnected;

    this.close(browser, session);
  };

  public getBrowserForRequest = async (
    req: Request,
    router: BrowserHTTPRoute | BrowserWebsocketRoute,
  ): Promise<BrowserInstance> => {
    const { browser: Browser } = router;
    const record = util.parseBooleanParam(
      req.parsed.searchParams,
      'record',
      false,
    );
    const blockAds = util.parseBooleanParam(
      req.parsed.searchParams,
      'blockAds',
      false,
    );
    const decodedLaunchOptions = util.convertIfBase64(
      req.parsed.searchParams.get('launch') || '{}',
    );
    let parsedLaunchOptions: BrowserServerOptions | CDPLaunchOptions;

    // Handle re-connects here:
    if (req.parsed.pathname.includes('/devtools/browser')) {
      const sessions = Array.from(this.browsers);
      const id = req.parsed.pathname.split('/').pop() as string;
      const browser = sessions.find(
        ([b]) => b.wsEndpoint()?.includes(req.parsed.pathname),
      );

      if (browser) {
        debug(`Located browser with ID ${id}`);
        return browser[0];
      }

      throw new util.NotFound(
        `Couldn't locate browser "${id}" for request "${req.parsed.pathname}"`,
      );
    }

    try {
      parsedLaunchOptions = JSON.parse(decodedLaunchOptions);
    } catch (err) {
      throw new util.BadRequest(
        `Error parsing launch-options: ${err}. Launch options must be a JSON or base64-encoded JSON object`,
      );
    }
    const requestToken = util.getTokenFromRequest(req);

    if (!requestToken) {
      throw new util.ServerError(`Error locating authorization token`);
    }

    const routerOptions =
      typeof router.defaultLaunchOptions === 'function'
        ? router.defaultLaunchOptions(req)
        : router.defaultLaunchOptions;

    const launchOptions = {
      ...routerOptions,
      ...parsedLaunchOptions,
    };

    const manualUserDataDir =
      launchOptions.args
        ?.find((arg) => arg.includes('--user-data-dir='))
        ?.split('=')[2] || (launchOptions as CDPLaunchOptions).userDataDir;

    // Always specify a user-data-dir since plugins can "inject" their own
    // unless it's playwright which takes care of its own data-dirs
    const userDataDir =
      manualUserDataDir ||
      (Browser.name === CDPChromium.name ? await this.generateDataDir() : null);

    const browser = new Browser({
      blockAds,
      config: this.config,
      record,
      userDataDir,
    });

    const connectionMeta: BrowserlessSession = {
      id: null,
      initialConnectURL:
        path.join(req.parsed.pathname, req.parsed.search) || '',
      isTempDataDir: !manualUserDataDir,
      launchOptions,
      numbConnected: 1,
      resolver: util.noop,
      routePath: router.path,
      startedOn: Date.now(),
      ttl: 0,
      userDataDir,
    };

    this.browsers.set(browser, connectionMeta);

    await browser.launch(launchOptions as object);
    await browserHook({ browser, meta: req.parsed });

    browser.on('newPage', async (page) => {
      await pageHook({ meta: req.parsed, page });
      (router.onNewPage || util.noop)(req.parsed || '', page);
    });

    return browser;
  };

  public stop = async (): Promise<void> => {
    debug(`Closing down browser instances`);
    const sessions = Array.from(this.browsers);
    await Promise.all(sessions.map(([b]) => b.close()));
    const timers = Array.from(this.timers);
    await Promise.all(timers.map(([, timer]) => clearInterval(timer)));
    this.timers.forEach((t) => clearTimeout(t));
    this.browsers = new Map();
    this.timers = new Map();

    debug(`Shutdown complete`);
  };
}
