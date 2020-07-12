import { ChildProcess } from 'child_process';
// @ts-ignore no types
import * as chromeDriver from 'chromedriver';
import * as _ from 'lodash';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import { ParsedUrlQuery } from 'querystring';
import { Transform } from 'stream';
import * as url from 'url';

import { Features } from './features';
import { browserHook, pageHook } from './hooks';
import { fetchJson, getDebug, getUserDataDir, rimraf } from './utils';

import {
  IBrowser,
  IBrowserlessSessionOptions,
  ILaunchOptions,
  IWindowSize,
  ISession,
  IChromeDriver,
  IHTTPRequest,
  IJSONList,
} from './types';

import {
  DEFAULT_BLOCK_ADS,
  DEFAULT_HEADLESS,
  DEFAULT_IGNORE_DEFAULT_ARGS,
  DEFAULT_IGNORE_HTTPS_ERRORS,
  DEFAULT_LAUNCH_ARGS,
  DEFAULT_USER_DATA_DIR,
  DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR,
  DISABLED_FEATURES,
  HOST,
  PORT,
  PROXY_HOST,
  PROXY_PORT,
  PROXY_SSL,
  WORKSPACE_DIR,
} from './config';

const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const treekill = require('tree-kill');
const {
  CHROME_BINARY_LOCATION,
  USE_CHROME_STABLE,
  PUPPETEER_CHROMIUM_REVISION,
} = require('../env');

const BROWSERLESS_ARGS = [
  '--no-sandbox',
  '--enable-logging',
  '--v1=1',
  '--disable-dev-shm-usage',
];

const blacklist = require('../hosts.json');
const networkBlock = (request: puppeteer.Request) => {
  const fragments = request.url().split('/');
  const domain = fragments.length > 2 ? fragments[2] : null;
  if (blacklist.includes(domain)) {
    return request.abort();
  }
  return request.continue();
};

let runningBrowsers: IBrowser[] = [];

const parseIgnoreDefaultArgs = (query: ParsedUrlQuery): string[] | boolean => {
  const defaultArgs = query.ignoreDefaultArgs;

  if (_.isUndefined(defaultArgs) || defaultArgs === 'false') {
    return false;
  }

  if (defaultArgs === '' || defaultArgs === 'true') {
    return true;
  }

  return Array.isArray(defaultArgs) ?
    defaultArgs :
    defaultArgs.split(',');
};

const getTargets = async ({ port }: { port: string }): Promise<IJSONList[]> =>
  fetchJson(`http://127.0.0.1:${port}/json/list`);

const setupPage = async ({
  page,
  pauseOnConnect,
  blockAds,
  trackingId,
  windowSize,
}: {
  page: puppeteer.Page;
  pauseOnConnect: boolean;
  blockAds: boolean;
  trackingId: string | null;
  windowSize?: IWindowSize
}) => {
  const client = _.get(page, '_client', _.noop);

  await pageHook({ page });

  // Don't let us intercept these as they're needed by consumers
  // Fixed in later version of chromium
  if (USE_CHROME_STABLE || PUPPETEER_CHROMIUM_REVISION <= 706915) {
    debug(`Patching file-chooser dialog`);
    client
      .send('Page.setInterceptFileChooserDialog', { enabled: false })
      .catch(_.noop);
  }

  if (!DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR) {
    const workspaceDir = trackingId ?
      path.join(WORKSPACE_DIR, trackingId) :
      WORKSPACE_DIR;

    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: workspaceDir,
    }).catch(_.noop);
  }

  if (pauseOnConnect && !DISABLED_FEATURES.includes(Features.DEBUG_VIEWER)) {
    await client.send('Debugger.enable');
    await client.send('Debugger.pause');
  }

  if (blockAds) {
    await page.setRequestInterception(true);
    page.on('request', networkBlock);
  }

  if (windowSize) {
    await page.setViewport(windowSize);
  }

  page.once('close', () => page.off('request', networkBlock));
};

const setupBrowser = async ({
  browser: pptrBrowser,
  isUsingTempDataDir,
  prebooted,
  browserlessDataDir,
  blockAds,
  pauseOnConnect,
  trackingId,
  keepalive,
  process,
  windowSize,
  port,
}: {
  browser: puppeteer.Browser;
  isUsingTempDataDir: boolean;
  browserlessDataDir: string | null;
  blockAds: boolean;
  pauseOnConnect: boolean;
  process: ChildProcess;
  trackingId: string | null;
  keepalive: number | null;
  windowSize?: IWindowSize;
  prebooted: boolean;
  port: number | string;
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

  const { webSocketDebuggerUrl } = await fetchJson(`http://localhost:${port}/json/version`)
    .catch((err) => {
      closeBrowser(browser);
      throw err;
    });

  browser._parsed = url.parse(webSocketDebuggerUrl, true);
  browser._wsEndpoint = webSocketDebuggerUrl;
  browser._id = (browser._parsed.pathname as string).split('/').pop() as string;

  await browserHook({ browser });

  browser._browserProcess.once('exit', (code, signal) => {
    debug(`Browser process exited with code ${code} and signal ${signal}, cleaning up`);
    closeBrowser(browser)
  });

  browser.on('targetcreated', async (target) => {
    try {
      const page = await target.page();

      if (page && !page.isClosed()) {
        // @ts-ignore
        setupPage({
          page,
          windowSize,
          blockAds: browser._blockAds,
          pauseOnConnect: browser._pauseOnConnect,
          trackingId: browser._trackingId,
        });
      }
    } catch (error) {
      debug(`Error setting up new browser`, error);
    }
  });

  const pages = await browser.pages();

  pages.forEach((page) => setupPage({ blockAds, page, pauseOnConnect, trackingId, windowSize }));
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
};

/*
 * Does a deep check to see if the prebooted chrome's arguments,
 * and other options, match those requested by the HTTP request
 */
export const canUsePrebootedChrome = (launchArgs: ILaunchOptions) => {
  if (!_.isUndefined(launchArgs.headless) && launchArgs.headless !== defaultLaunchArgs.headless) {
    return false;
  }

  if (!_.isUndefined(launchArgs.args) && launchArgs.args.length !== defaultLaunchArgs.args.length) {
    return false;
  }

  return true;
};

export const findSessionForPageUrl = async (pathname: string) => {
  const pages = await getDebuggingPages();

  return pages.find((session) => session.devtoolsFrontendUrl.includes(pathname));
};

export const findSessionForBrowserUrl = async (pathname: string) => {
  const pages = await getDebuggingPages();

  return pages.find((session) => session.browserWSEndpoint.includes(pathname));
};

export const getDebuggingPages = async (): Promise<ISession[]> => {
  const results = await Promise.all(
    runningBrowsers.map(async (browser) => {
      const { port } = browser._parsed;

      const externalHost = PROXY_HOST ?
        `${PROXY_HOST}${PROXY_PORT ? `:${PROXY_PORT}` : ''}` :
        `${HOST || '127.0.0.1'}:${PORT}`;

      const externalProtocol = PROXY_SSL ? 'wss' : 'ws';

      if (!port) {
        throw new Error(`Error finding port in browser endpoint: ${port}`);
      }

      const sessions = await getTargets({ port });

      return sessions
        .map((session) => {
          const wsEndpoint = browser._wsEndpoint;
          const proxyParams = {
            host: externalHost,
            protocol: externalProtocol,
            slashes: true,
          };

          const parsedWebSocketDebuggerUrl = {
            ...url.parse(session.webSocketDebuggerUrl),
            ...proxyParams,
          };

          const parsedWsEndpoint = {
            ...url.parse(wsEndpoint),
            ...proxyParams,
          };

          const browserWSEndpoint = url.format(parsedWsEndpoint);
          const webSocketDebuggerUrl = url.format(parsedWebSocketDebuggerUrl);
          const devtoolsFrontendUrl = url.format({
            pathname: url.parse(session.devtoolsFrontendUrl).pathname,
            search: `?${externalProtocol}=${externalHost}${parsedWebSocketDebuggerUrl.path}`,
          });

          return {
            ...session,
            browserId: browser._id,
            browserWSEndpoint,
            devtoolsFrontendUrl,
            port,
            trackingId: browser._trackingId,
            webSocketDebuggerUrl,
          };
        });
    }),
  );

  return _.flatten(results);
};

export const getBrowsersRunning = () => runningBrowsers.length;

export const convertUrlParamsToLaunchOpts = (req: IHTTPRequest): ILaunchOptions => {
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
    userDataDir,
    pause,
    trackingId,
    keepalive: keepaliveQuery,
  } = urlParts.query;

  const isHeadless = !_.isUndefined(headless) ?
    headless !== 'false' :
    DEFAULT_HEADLESS;

  const parsedKeepalive = _.parseInt(keepaliveQuery as string);
  const keepalive = _.isNaN(parsedKeepalive) ? undefined : parsedKeepalive;
  const parsedIgnoreDefaultArgs = parseIgnoreDefaultArgs(urlParts.query);

  return {
    args: !_.isEmpty(args) ? args : DEFAULT_LAUNCH_ARGS,
    blockAds: !_.isUndefined(blockAds) || DEFAULT_BLOCK_ADS,
    headless: isHeadless,
    ignoreDefaultArgs: parsedIgnoreDefaultArgs,
    ignoreHTTPSErrors: !_.isUndefined(ignoreHTTPSErrors) || DEFAULT_IGNORE_HTTPS_ERRORS,
    keepalive,
    pauseOnConnect: !_.isUndefined(pause),
    slowMo: parseInt(slowMo as string, 10) || undefined,
    trackingId: _.isArray(trackingId) ? trackingId[0] : trackingId,
    userDataDir: userDataDir as string || DEFAULT_USER_DATA_DIR,
  };
};

export const launchChrome = async (opts: ILaunchOptions, isPreboot: boolean): Promise<IBrowser> => {
  const port = await getPort();
  let isUsingTempDataDir = true;
  let browserlessDataDir: string | null = null;

  const launchArgs = {
    ...opts,
    args: [
      ...BROWSERLESS_ARGS,
      ...(opts.args || []),
      `--remote-debugging-port=${port}`
    ],
    executablePath: CHROME_BINARY_LOCATION,
    handleSIGINT: false,
    handleSIGTERM: false,
  };

  // Having a user-data-dir in args is higher precedence than in opts
  const hasUserDataDir = _.some((launchArgs.args), (arg) => arg.includes('--user-data-dir='));
  const isHeadless = launchArgs.args.some(arg => arg.startsWith('--headless')) || (
    typeof launchArgs.headless === 'undefined' ||
    launchArgs.headless === true
  );

  if (hasUserDataDir || opts.userDataDir) {
    isUsingTempDataDir = false;
  }

  // If no data-dir is specified, use the default one in opts or generate one
  if (!hasUserDataDir) {
    browserlessDataDir = opts.userDataDir || await getUserDataDir();
    launchArgs.args.push(`--user-data-dir=${browserlessDataDir}`);
  }

  // Only use debugging pipe when headless
  if (isHeadless) {
    launchArgs.args.push(`--remote-debugging-pipe`);
  }

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs, null, '  ')}`);

  return puppeteer.launch(launchArgs)
    .then((browser: IBrowser) => setupBrowser({
      blockAds: opts.blockAds,
      browser,
      browserlessDataDir,
      isUsingTempDataDir,
      keepalive: opts.keepalive || null,
      pauseOnConnect: opts.pauseOnConnect,
      process: browser.process(),
      trackingId: opts.trackingId || null,
      windowSize: undefined,
      prebooted: isPreboot,
      port,
    }));
};

export const launchChromeDriver = async ({
  blockAds = false,
  trackingId = null,
  pauseOnConnect = false,
  browserlessDataDir = null,
  windowSize,
  isUsingTempDataDir,
}: IBrowserlessSessionOptions) => {
  return new Promise<IChromeDriver>(async (resolve, reject) => {
    const port = await getPort();
    let iBrowser = null;
    const flags = ['--url-base=webdriver', '--verbose', `--port=${port}`, '--whitelisted-ips'];
    debug(`Launching ChromeDriver with args: ${JSON.stringify(flags)}`);

    const chromeProcess: ChildProcess = await chromeDriver.start(flags, true);
    const findPort = new Transform({
      transform: async (chunk, _, done) => {
        const message = chunk.toString();
        const match = message.match(/DevTools listening on (ws:\/\/.*)/);

        if (match) {
          chromeProcess.stderr && chromeProcess.stderr.unpipe(findPort);
          const [, wsEndpoint] = match;
          debug(`Attaching to chromedriver browser on ${wsEndpoint}`);

          const browser: puppeteer.Browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
          const { port } = url.parse(wsEndpoint);

          iBrowser = await setupBrowser({
            blockAds,
            browser,
            browserlessDataDir,
            isUsingTempDataDir,
            prebooted: false,
            keepalive: null,
            pauseOnConnect,
            process: chromeProcess,
            trackingId,
            windowSize,
            port: port as string,
          });
        }

        done(null, chunk);
      },
    });

    if (!chromeProcess.stderr) {
      return reject(`Couldn't setup the chromedriver process`);
    }

    chromeProcess.stderr.pipe(findPort);

    return resolve({
      browser: iBrowser,
      chromeProcess,
      port,
    });
  });
};

export const killAll = async () => {
  await Promise.all(runningBrowsers.map((browser) => closeBrowser(browser)));

  runningBrowsers = [];

  return;
};

export const kill = (id: string) => {
  const browser = runningBrowsers.find((b) => b._id === id);

  if (browser) {
    return closeBrowser(browser);
  }

  return null;
};

export const closeBrowser = async (browser: IBrowser) => {
  if (!browser._isOpen) {
    return;
  }

  browser._isOpen = false;
  debug(`Shutting down browser with close command`);

  try {
    browser._keepaliveTimeout && clearTimeout(browser._keepaliveTimeout);

    if (browser._browserlessDataDir) {
      debug(`Removing temp data-dir ${browser._browserlessDataDir}`);
      rimraf(browser._browserlessDataDir);
    }

    runningBrowsers = runningBrowsers.filter((b) => b._wsEndpoint !== browser._wsEndpoint);
    browser.disconnect();
    browser.removeAllListeners();
  } catch (error) {
    debug(`Browser close emitted an error ${error.message}`);
  } finally {
    debug(`Sending SIGKILL signal to browser process ${browser._browserProcess.pid}`);
    treekill(browser._browserProcess.pid, 'SIGKILL');
  }
};
