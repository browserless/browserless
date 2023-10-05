import { ChildProcess } from 'child_process';

// @ts-ignore no types
import path from 'path';

import { ParsedUrlQuery } from 'querystring';

import { Transform } from 'stream';

import url from 'url';

// @ts-ignore no types
import chromeDriver from 'chromedriver';
import getPort from 'get-port';
import _ from 'lodash';
// @ts-ignore no types
import { BrowserServer } from 'playwright-core';
import puppeteer, { Browser, Page } from 'puppeteer';
import pptrExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import treeKill from 'tree-kill';
import untildify from 'untildify';

import {
  ALLOW_FILE_PROTOCOL,
  DEFAULT_BLOCK_ADS,
  DEFAULT_DUMPIO,
  DEFAULT_HEADLESS,
  DEFAULT_STEALTH,
  DEFAULT_IGNORE_DEFAULT_ARGS,
  DEFAULT_IGNORE_HTTPS_ERRORS,
  DEFAULT_LAUNCH_ARGS,
  DEFAULT_USER_DATA_DIR,
  DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR,
  DISABLED_FEATURES,
  HOST,
  PORT,
  PROXY_URL,
  WORKSPACE_DIR,
} from './config';
import { PLAYWRIGHT_ROUTE } from './constants';
import { Features } from './features';
import { browserHook, pageHook, puppeteerHook } from './hooks';
import { getPlaywright } from './playwright-provider';

import {
  IBrowser,
  IBrowserlessSessionOptions,
  ILaunchOptions,
  IWindowSize,
  ISession,
  IChromeDriver,
  IHTTPRequest,
  IDevtoolsJSON,
  IPage,
  PuppeteerRequest,
  HeadlessType,
} from './types.d';
import {
  fetchJson,
  getDebug,
  getUserDataDir,
  getCDPClient,
  injectHostIntoSession,
  mkDataDir,
  rimraf,
  sleep,
} from './utils';

const {
  CHROME_BINARY_LOCATION,
  USE_CHROME_STABLE,
  PUPPETEER_CHROMIUM_REVISION,
} = require('../env');

const blacklist = require('../hosts.json');

const {
  dependencies: {
    puppeteer: { version: puppeteerVersion },
  },
} = require('../package-lock.json');

let versionCache: object;
let protocolCache: object;

const debug = getDebug('chrome-helper');

const BROWSERLESS_ARGS = [
  '--no-sandbox',
  '--enable-logging',
  '--v1=1',
  '--disable-dev-shm-usage',
  '--no-first-run',
];

const externalURL = PROXY_URL
  ? new URL(PROXY_URL)
  : new URL(`http://${HOST || `127.0.0.1`}:${PORT}`);

const removeDataDir = (dir: string | null) => {
  if (dir) {
    debug(`Removing temp data-dir ${dir}`);
    rimraf(dir)
      .then(() => debug(`Temp dir ${dir} removed successfully`))
      .catch((e) => debug(`Error deleting ${dir}: ${e}`));
  }
};

const networkBlock = (request: PuppeteerRequest) => {
  const fragments = request.url().split('/');
  const domain = fragments.length > 2 ? fragments[2] : null;
  // @ts-ignore alter to any for bw compatibility with old puppeteer
  if ((request as any)?.isInterceptResolutionHandled()) {
    return;
  }
  if (blacklist.includes(domain)) {
    return request.abort();
  }
  return request.continue();
};

let runningBrowsers: IBrowser[] = [];

pptrExtra.use(StealthPlugin());

const parseIgnoreDefaultArgs = (query: ParsedUrlQuery): string[] | boolean => {
  const defaultArgs = query.ignoreDefaultArgs;

  if (_.isUndefined(defaultArgs) || defaultArgs === 'false') {
    return false;
  }

  if (defaultArgs === '' || defaultArgs === 'true') {
    return true;
  }

  return Array.isArray(defaultArgs) ? defaultArgs : defaultArgs.split(',');
};

const getTargets = async ({
  port,
}: {
  port: string;
}): Promise<IDevtoolsJSON[]> =>
  fetchJson(`http://127.0.0.1:${port}/json/list`, {
    headers: {
      Host: '127.0.0.1',
    },
  });

const isPuppeteer = (
  browserServer: Browser | BrowserServer,
): browserServer is Browser => {
  return (browserServer as Browser).disconnect !== undefined;
};

const setupPage = async ({
  browser,
  page: pptrPage,
  pauseOnConnect,
  blockAds,
  trackingId,
  windowSize,
  meta,
}: {
  browser: IBrowser;
  page: Page;
  pauseOnConnect: boolean;
  blockAds: boolean;
  trackingId: string | null;
  windowSize?: IWindowSize;
  meta: unknown;
}) => {
  const page = pptrPage as IPage;

  if (page._browserless_setup) {
    return;
  }

  const client = getCDPClient(pptrPage);

  if (!client) {
    throw new Error(`Error setting up page, CDP client doesn't exist!`);
  }

  const id = _.get(page, '_target._targetId', 'Unknown');

  await pageHook({ page, meta });

  debug(`Setting up page ${id}`);

  // Don't let us intercept these as they're needed by consumers
  // Fixed in later version of chromium
  if (USE_CHROME_STABLE || PUPPETEER_CHROMIUM_REVISION <= 706915) {
    debug(`Patching file-chooser dialog`);
    client
      .send('Page.setInterceptFileChooserDialog', { enabled: false })
      .catch(_.noop);
  }

  // Only inject download behaviors for puppeteer when it's enabled
  if (
    !DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR &&
    isPuppeteer(browser._browserServer)
  ) {
    const workspaceDir = trackingId
      ? path.join(WORKSPACE_DIR, trackingId)
      : WORKSPACE_DIR;

    debug(`Injecting download dir "${workspaceDir}"`);

    await client
      .send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: workspaceDir,
      })
      .catch(_.noop);
  }

  if (pauseOnConnect && !DISABLED_FEATURES.includes(Features.DEBUG_VIEWER)) {
    await client.send('Debugger.enable');
    await client.send('Debugger.pause');
  }

  if (!ALLOW_FILE_PROTOCOL) {
    debug(`Setting up file:// protocol request rejection`);
    page.on('request', async (request) => {
      if (request.url().startsWith('file://')) {
        debug(`File protocol request found in request, terminating`);
        page.close().catch(_.noop);
        closeBrowser(browser);
      }
    });

    page.on('response', async (response) => {
      if (response.url().startsWith('file://')) {
        debug(`File protocol request found in response, terminating`);
        page.close().catch(_.noop);
        closeBrowser(browser);
      }
    });
  }

  if (blockAds) {
    debug(`Setting up page for ad-blocking`);
    await page.setRequestInterception(true);
    page.on('request', networkBlock);
    page.once('close', () => page.off('request', networkBlock));
  }

  if (windowSize) {
    debug(`Setting viewport dimensions`);
    await page.setViewport(windowSize);
  }

  page._browserless_setup = true;
  browser._pages.push(page);
};

const setupBrowser = async ({
  browser: pptrBrowser,
  browserWSEndpoint,
  isUsingTempDataDir,
  prebooted,
  browserlessDataDir,
  blockAds,
  pauseOnConnect,
  trackingId,
  keepalive,
  process,
  windowSize,
  browserServer,
  meta,
}: {
  browser: Browser;
  browserWSEndpoint: string;
  isUsingTempDataDir: boolean;
  browserlessDataDir: string | null;
  blockAds: boolean;
  pauseOnConnect: boolean;
  process: ChildProcess;
  trackingId: string | null;
  keepalive: number | null;
  windowSize?: IWindowSize;
  prebooted: boolean;
  browserServer: BrowserServer | Browser;
  meta: unknown;
}): Promise<IBrowser> => {
  debug(`Chrome PID: ${process.pid}`);
  const browser = pptrBrowser as IBrowser;

  browser._isOpen = true;
  browser._keepalive = keepalive;
  browser._browserProcess = process;
  browser._isUsingTempDataDir = isUsingTempDataDir;
  browser._browserlessDataDir = browserlessDataDir;
  browser._trackingId = trackingId;
  browser._keepaliveTimeout = null;
  browser._startTime = Date.now();
  browser._prebooted = prebooted;
  browser._blockAds = blockAds;
  browser._pauseOnConnect = pauseOnConnect;
  browser._browserServer = browserServer;
  browser._pages = [];

  browser._parsed = url.parse(browserWSEndpoint, true);
  browser._wsEndpoint = browserWSEndpoint;
  browser._id = (browser._parsed.pathname as string).split('/').pop() as string;

  await browserHook({ browser, meta });

  process.once('close', () => {
    debug(`Browser process ${browser._id} has closed, cleaning up.`);
    closeBrowser(browser);
  });
  browser.on('targetcreated', async (target) => {
    try {
      const page = await target.page();

      if (page && !page.isClosed()) {
        // @ts-ignore
        setupPage({
          browser,
          page,
          windowSize,
          blockAds: browser._blockAds,
          pauseOnConnect: browser._pauseOnConnect,
          trackingId: browser._trackingId,
          meta,
        });
      }
    } catch (error) {
      debug(`Error setting up new browser`, error);
    }
  });

  debug('Finding prior pages');

  const pages = (await Promise.race([browser.pages(), sleep(2500)])) as
    | Page[]
    | undefined;

  if (pages && pages.length) {
    debug(`Found ${pages.length} pages`);
    pages.forEach((page) =>
      setupPage({
        browser,
        blockAds,
        page,
        pauseOnConnect,
        trackingId,
        windowSize,
        meta,
      }),
    );
  }

  runningBrowsers.push(browser);

  return browser;
};

export const defaultLaunchArgs = {
  args: DEFAULT_LAUNCH_ARGS,
  blockAds: DEFAULT_BLOCK_ADS,
  headless: DEFAULT_HEADLESS,
  ignoreDefaultArgs: DEFAULT_IGNORE_DEFAULT_ARGS,
  ignoreHTTPSErrors: DEFAULT_IGNORE_HTTPS_ERRORS,
  pauseOnConnect: false,
  slowMo: undefined,
  userDataDir: DEFAULT_USER_DATA_DIR,
  playwright: false,
  stealth: DEFAULT_STEALTH,
  meta: null,
};

/*
 * Does a deep check to see if the prebooted chrome's arguments,
 * and other options, match those requested by the HTTP request
 */
export const canUsePrebootedChrome = (launchArgs: ILaunchOptions) => {
  if (
    !_.isUndefined(launchArgs.headless) &&
    launchArgs.headless !== defaultLaunchArgs.headless
  ) {
    return false;
  }

  if (
    !_.isUndefined(launchArgs.args) &&
    launchArgs.args.length !== defaultLaunchArgs.args.length
  ) {
    return false;
  }

  return true;
};

export const findSessionForPageUrl = async (pathname: string) => {
  const pages = await getDebuggingPages();

  return pages.find((session) =>
    session.devtoolsFrontendUrl.includes(pathname),
  );
};

export const findSessionForBrowserUrl = async (pathname: string) => {
  const pages = await getDebuggingPages();

  return pages.find((session) => session.browserWSEndpoint.includes(pathname));
};

export const getDebuggingPages = async (
  trackingId?: string,
): Promise<ISession[]> => {
  const results = await Promise.all(
    runningBrowsers
      .filter(
        (browser) =>
          typeof trackingId === 'undefined' ||
          browser._trackingId === trackingId,
      )
      .map(async (browser) => {
        const { port } = browser._parsed;

        if (!port) {
          throw new Error(`Error finding port in browser endpoint: ${port}`);
        }

        const sessions = await getTargets({ port }).catch((e) => {
          debug(
            `Error fetching sessions from target: ${e.message} ${e.stack}.`,
          );
          return [];
        });

        return sessions.map((session) =>
          injectHostIntoSession(externalURL, browser, session),
        );
      }),
  );

  return _.flatten(results);
};

export const getBrowsersRunning = () => runningBrowsers.length;

const parseHeadlessValue = (
  param: string | string[] | undefined,
): HeadlessType =>
  _.isUndefined(param)
    ? DEFAULT_HEADLESS
    : param === 'new'
    ? 'new'
    : param === 'false'
    ? false
    : true;

export const convertUrlParamsToLaunchOpts = (
  req: IHTTPRequest,
): ILaunchOptions => {
  const urlParts = req.parsed;
  const args = _.chain(urlParts.query)
    .pickBy((_value, param) => _.startsWith(param, '--'))
    .map((value, key) => `${key}${value ? `=${value}` : ''}`)
    .value();

  const {
    blockAds,
    headless,
    ignoreHTTPSErrors,
    slowMo,
    stealth,
    userDataDir,
    pause,
    trackingId,
    keepalive: keepaliveQuery,
    dumpio: dumpioQuery,
    playwrightProxy: playwrightProxyQuery,
  } = urlParts.query;

  const playwright = req.parsed.pathname === PLAYWRIGHT_ROUTE;

  const headlessValue = parseHeadlessValue(headless);

  const isStealth = !_.isUndefined(stealth)
    ? stealth !== 'false'
    : DEFAULT_STEALTH;

  const dumpio = !_.isUndefined(dumpioQuery)
    ? dumpioQuery !== 'false'
    : DEFAULT_DUMPIO;

  const playwrightProxy = (() => {
    let res = undefined;

    if (!_.isUndefined(playwrightProxyQuery)) {
      try {
        res = JSON.parse(decodeURIComponent(playwrightProxyQuery as string));
      } catch (err) {
        debug(
          `Error parsing playwright-proxy param to JSON: ${playwrightProxyQuery} isn't properly URL-encoded or JSON.stringified.`,
        );
      }
    }

    return res;
  })();

  const parsedKeepalive = _.parseInt(keepaliveQuery as string);
  const keepalive = _.isNaN(parsedKeepalive) ? undefined : parsedKeepalive;
  const parsedIgnoreDefaultArgs = parseIgnoreDefaultArgs(urlParts.query);

  const playwrightVersion = (() => {
    const uAgent = req.headers['user-agent'];
    if (!uAgent || !uAgent.startsWith('Playwright/')) return undefined;

    const matches = uAgent.match(/(?<=Playwright\/)(\d+(\.\d+))/);
    return _.first(matches);
  })();

  return {
    args: !_.isEmpty(args) ? args : DEFAULT_LAUNCH_ARGS,
    blockAds: !_.isUndefined(blockAds) || DEFAULT_BLOCK_ADS,
    dumpio,
    headless: headlessValue,
    stealth: isStealth,
    ignoreDefaultArgs: parsedIgnoreDefaultArgs,
    ignoreHTTPSErrors:
      !_.isUndefined(ignoreHTTPSErrors) || DEFAULT_IGNORE_HTTPS_ERRORS,
    keepalive,
    pauseOnConnect: !_.isUndefined(pause),
    playwright,
    playwrightProxy,
    playwrightVersion,
    slowMo: parseInt(slowMo as string, 10) || undefined,
    trackingId: _.isArray(trackingId) ? trackingId[0] : trackingId,
    userDataDir: (userDataDir as string) || DEFAULT_USER_DATA_DIR,
    meta: urlParts,
  };
};

export const launchChrome = async (
  opts: ILaunchOptions,
  isPreboot: boolean,
): Promise<IBrowser> => {
  const port = await getPort();
  let isUsingTempDataDir = true;
  let browserlessDataDir: string | null = null;

  const launchArgs = {
    ...opts,
    args: [
      ...BROWSERLESS_ARGS,
      ...(opts.args || []),
      `--remote-debugging-port=${port}`,
    ],
    executablePath: CHROME_BINARY_LOCATION,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };

  const isPlaywright = launchArgs.playwright;

  // Having a user-data-dir in args is higher precedence than in opts
  const manualUserDataDir =
    launchArgs.args
      .find((arg) => arg.includes('--user-data-dir='))
      ?.split('=')[1] || opts.userDataDir;

  // not necessary to allow it to be "new", since it's used to
  // set an arg if it's Playwright and not headless=false
  const isHeadless =
    launchArgs.args.some((arg) => arg.startsWith('--headless')) ||
    typeof launchArgs.headless === 'undefined' ||
    launchArgs.headless === true;

  if (!!manualUserDataDir || opts.userDataDir) {
    isUsingTempDataDir = false;
  }

  // If no data-dir is specified, use the default one in opts or generate one
  // except for playwright which will error doing so.
  if (manualUserDataDir) {
    const explodedPath = untildify(manualUserDataDir);
    await mkDataDir(explodedPath);
    opts.userDataDir = explodedPath;
    launchArgs.args.push(`--user-data-dir=${explodedPath}`);
    launchArgs.userDataDir = explodedPath;
  } else {
    browserlessDataDir = opts.userDataDir || (await getUserDataDir());
    launchArgs.args.push(`--user-data-dir=${browserlessDataDir}`);
    launchArgs.userDataDir = browserlessDataDir;
  }

  // Only use debugging pipe when headless except for playwright which
  // will error in doing so.
  if (isHeadless && !launchArgs.ignoreDefaultArgs) {
    launchArgs.args.push(`--remote-debugging-pipe`);
  }

  // Reset playwright to a workable state since it can't run head-full or use
  // a user-data-dir
  if (isPlaywright) {
    launchArgs.args = launchArgs.args.filter(
      (arg) =>
        !arg.startsWith('--user-data-dir') && arg !== '--remote-debugging-pipe',
    );
  }

  debug(
    `Launching Chrome with args: ${JSON.stringify(launchArgs, null, '  ')}`,
  );

  const injectedPuppeteer = await puppeteerHook(opts);

  // as any due to compatibility issues with pptr 16 <
  const finalLaunch = launchArgs as any;
  const browserServerPromise = injectedPuppeteer
    ? injectedPuppeteer.launch(finalLaunch)
    : launchArgs.playwright
    ? (await getPlaywright(opts.playwrightVersion)).launchServer({
        ...launchArgs,
        proxy: launchArgs.playwrightProxy,
      })
    : launchArgs.stealth
    ? pptrExtra.launch(finalLaunch)
    : puppeteer.launch(finalLaunch);

  const browserServer = await browserServerPromise.catch((e: Error) => {
    removeDataDir(browserlessDataDir);
    throw e;
  });
  const { webSocketDebuggerUrl: browserWSEndpoint } = await fetchJson(
    `http://127.0.0.1:${port}/json/version`,
  ).catch((e) => {
    browserServer.close();
    throw e;
  });

  const iBrowser = isPuppeteer(browserServer)
    ? Promise.resolve(browserServer)
    : puppeteer.connect({ browserWSEndpoint });

  return iBrowser.then((browser) =>
    setupBrowser({
      blockAds: opts.blockAds,
      browser,
      browserlessDataDir,
      browserWSEndpoint,
      isUsingTempDataDir,
      keepalive: opts.keepalive || null,
      pauseOnConnect: opts.pauseOnConnect,
      process: browserServer.process() as ChildProcess,
      trackingId: opts.trackingId || null,
      windowSize: undefined,
      prebooted: isPreboot,
      browserServer,
      meta: opts.meta,
    }),
  );
};

export const launchChromeDriver = async ({
  stealth = false,
  blockAds = false,
  trackingId = null,
  pauseOnConnect = false,
  browserlessDataDir = null,
  windowSize,
  isUsingTempDataDir,
}: IBrowserlessSessionOptions) => {
  return new Promise<IChromeDriver>(async (resolve, reject) => {
    const port = await getPort();
    let iBrowser: null | IBrowser = null;
    const flags = [
      '--url-base=webdriver',
      '--verbose',
      `--port=${port}`,
      '--whitelisted-ips',
    ];
    debug(`Launching ChromeDriver with args: ${JSON.stringify(flags)}`);

    const chromeProcess: ChildProcess = await chromeDriver.start(flags, true);
    const findPort = new Transform({
      transform: async (chunk, _, done) => {
        const message = chunk.toString();
        const webDriverRegex = /(?:"webSocketDebuggerUrl": "(ws:\/\/.*))"/g;
        const cdpRegex = /DevTools listening on (ws:\/\/.*)/;

        const match = message.match(cdpRegex) || webDriverRegex.exec(message);

        if (match) {
          chromeProcess.stderr && chromeProcess.stderr.unpipe(findPort);
          const [, browserWSEndpoint] = match;
          debug(`Attaching to chromedriver browser on ${browserWSEndpoint}`);

          const browser: Browser = stealth
            ? await pptrExtra.connect({ browserWSEndpoint })
            : await puppeteer.connect({ browserWSEndpoint });

          // Chromedriver boot-loops if it can't hook into an existing page
          (await browser.pages()).length || (await browser.newPage());

          iBrowser = await setupBrowser({
            blockAds,
            browser,
            browserlessDataDir,
            browserWSEndpoint,
            isUsingTempDataDir,
            prebooted: false,
            keepalive: null,
            pauseOnConnect,
            process: chromeProcess,
            trackingId,
            windowSize,
            browserServer: browser,
            meta: null,
          });
        }

        done(null, chunk);
      },
    });

    if (!chromeProcess.stderr) {
      return reject(`Couldn't setup the chromedriver process`);
    }

    chromeProcess.stderr.pipe(findPort);

    // browser is "lazily" loaded here and not established until
    // later in selenium's lifecycle, hence why it's a "getter"
    // function and not passed via reference
    return resolve({
      browser: () => iBrowser,
      chromeProcess,
      port,
    });
  });
};

export const getVersionJSON = async () => {
  if (!versionCache) {
    const port = await getPort();
    const browser = await puppeteer.launch({
      executablePath: CHROME_BINARY_LOCATION,
      args: [...BROWSERLESS_ARGS, `--remote-debugging-port=${port}`],
    });

    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    const meta = await res.json();

    browser.close();

    const { 'WebKit-Version': webkitVersion } = meta;

    delete meta.webSocketDebuggerUrl;

    const debuggerVersion = webkitVersion.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)[1];

    versionCache = {
      ...meta,
      'Debugger-Version': debuggerVersion,
      'Puppeteer-Version': puppeteerVersion,
    };
  }

  return versionCache;
};

export const getProtocolJSON = async () => {
  if (!protocolCache) {
    const port = await getPort();
    const browser = await puppeteer.launch({
      executablePath: CHROME_BINARY_LOCATION,
      args: [...BROWSERLESS_ARGS, `--remote-debugging-port=${port}`],
    });

    const res = await fetch(`http://127.0.0.1:${port}/json/protocol`);
    protocolCache = await res.json();

    browser.close();
  }

  return protocolCache;
};

export const killAll = async () => {
  await Promise.all(runningBrowsers.map((browser) => closeBrowser(browser)));
};

export const kill = (id: string) => {
  const browser = runningBrowsers.find((b) => b._id === id);

  if (browser) {
    return closeBrowser(browser);
  }

  return null;
};

export const closeBrowser = (browser: IBrowser) => {
  if (!browser._isOpen) {
    return;
  }

  browser._isOpen = false;
  debug(`Shutting down browser with close command`);

  try {
    browser._keepaliveTimeout && clearTimeout(browser._keepaliveTimeout);
    runningBrowsers = runningBrowsers.filter(
      (b) => b._wsEndpoint !== browser._wsEndpoint,
    );

    /*
     * IMPORTANT
     * You can't use close due to the possibility of a unhandled error event in
     * a stream somewhere in puppeteer. Disconnect works, but doesn't cleanup events,
     * so we're left with #disconnect + a manual removeAllListeners call and setting
     * the browser object to `null` below to force it to collect
     */
    process.removeAllListeners('exit');
  } catch (error) {
    debug(`Browser close emitted an error ${error.message}`);
  } finally {
    process.nextTick(() => {
      debug(
        `Sending SIGKILL signal to browser process ${browser._browserProcess.pid}`,
      );
      const races = [sleep(1000), browser._browserServer.close()];
      const proc = browser.process();

      if (proc) {
        races.push(new Promise((r) => proc.once('close', r)));
      }

      // Allow listeners to close before we garbage collect, which
      // puppeteer-extra packages need
      Promise.race(races).then(() => {
        debug(`Garbage collecting and removing listeners`);
        browser._pages.forEach((page) => {
          page.removeAllListeners();
          // @ts-ignore force any garbage collection by nulling the page(s)
          page = null;
        });
        browser.removeAllListeners();
        // @ts-ignore force any garbage collection by nulling the browser
        browser = null;
      });

      if (browser._browserProcess.pid) {
        treeKill(browser._browserProcess.pid, 'SIGKILL');
      }

      if (browser._browserlessDataDir) {
        removeDataDir(browser._browserlessDataDir);
      }
    });
  }
};
