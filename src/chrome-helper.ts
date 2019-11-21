import { ChildProcess } from 'child_process';
// @ts-ignore no types
import * as chromeDriver from 'chromedriver';
import * as _ from 'lodash';
import * as path from 'path';
import * as puppeteer from 'puppeteer';
import * as url from 'url';

import { CHROME_BINARY_LOCATION } from './config';
import { Feature } from './features';
import { browserHook, pageHook } from './hooks';
import { fetchJson, getDebug, getUserDataDir, IHTTPRequest, rimraf } from './utils';

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
  WORKSPACE_DIR,
} from './config';

const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const treekill = require('tree-kill');

const BROWSERLESS_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];
const blacklist = require('../hosts.json');

let runningBrowsers: IBrowser[] = [];

export interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
  browser: IBrowser | null;
}

export interface IBrowser extends puppeteer.Browser {
  _isOpen: boolean;
  _isUsingTempDataDir: boolean;
  _keepalive: number | null;
  _keepaliveTimeout: NodeJS.Timeout | null;
  _parsed: url.UrlWithParsedQuery;
  _trackingId: string | null;
  _browserlessDataDir: string | null;
  _browserProcess: ChildProcess;
  _startTime: number;
}

interface ISession {
  description: string;
  devtoolsFrontendUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
  port: string;
  trackingId: string | null;
  browserWSEndpoint: string;
}

export interface ILaunchOptions extends puppeteer.LaunchOptions {
  pauseOnConnect: boolean;
  blockAds: boolean;
  trackingId?: string;
  keepalive?: number;
}

const setupPage = async ({
  page,
  pauseOnConnect,
  blockAds,
  trackingId,
}: {
  page: puppeteer.Page;
  pauseOnConnect: boolean;
  blockAds: boolean;
  trackingId: string | null;
}) => {
  const client = _.get(page, '_client', _.noop);

  await pageHook({ page });

  // Don't let us intercept these as they're needed by consumers
  client.send('Page.setInterceptFileChooserDialog', { enabled: false });

  if (!DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR) {
    const workspaceDir = trackingId ?
      path.join(WORKSPACE_DIR, trackingId) :
      WORKSPACE_DIR;

    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: workspaceDir,
    });
  }

  if (pauseOnConnect && !DISABLED_FEATURES.includes(Feature.DEBUG_VIEWER)) {
    await client.send('Debugger.enable');
    await client.send('Debugger.pause');
  }

  if (blockAds) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const fragments = request.url().split('/');
      const domain = fragments.length > 2 ? fragments[2] : null;
      if (blacklist.includes(domain)) {
        return request.abort();
      }
      return request.continue();
    });
  }

  page.once('close', () => page.removeAllListeners());
};

const setupBrowser = async ({
  browser,
  isUsingTempDataDir,
  browserlessDataDir,
  blockAds,
  pauseOnConnect,
  trackingId,
  keepalive,
  process,
}: {
  browser: puppeteer.Browser;
  isUsingTempDataDir: boolean;
  browserlessDataDir: string | null;
  blockAds: boolean;
  pauseOnConnect: boolean;
  process: ChildProcess;
  trackingId: string | null;
  keepalive: number | null;
}): Promise<IBrowser> => {
  debug(`Chrome PID: ${process.pid}`);
  const iBrowser = browser as IBrowser;

  iBrowser._isOpen = true;
  iBrowser._parsed = url.parse(iBrowser.wsEndpoint(), true);
  iBrowser._keepalive = keepalive;
  iBrowser._browserProcess = process;
  iBrowser._isUsingTempDataDir = isUsingTempDataDir;
  iBrowser._browserlessDataDir = browserlessDataDir;
  iBrowser._trackingId = trackingId;
  iBrowser._keepaliveTimeout = null;
  iBrowser._startTime = Date.now();

  await browserHook({ browser: iBrowser });

  iBrowser._browserProcess.on('exit', () => closeBrowser(iBrowser));

  iBrowser.on('targetcreated', async (target) => {
    try {
      const page = await target.page();

      if (page && !page.isClosed()) {
        // @ts-ignore
        setupPage({
          blockAds,
          page,
          pauseOnConnect,
          trackingId,
        });
      }
    } catch (error) {
      debug(`Error setting up new browser`, error);
    }
  });

  const pages = await iBrowser.pages();

  pages.forEach((page) => setupPage({ blockAds, page, pauseOnConnect, trackingId }));
  runningBrowsers.push(iBrowser);

  return iBrowser;
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
      const host = HOST || '127.0.0.1';

      if (!port) {
        throw new Error('Error locating port in browser endpoint: ${endpoint}');
      }

      const sessions: ISession[] = await fetchJson(`http://127.0.0.1:${port}/json/list`);

      return sessions
        .filter(({ title }) => title !== 'about:blank')
        .map((session) => {
          const browserWSEndpoint = browser.wsEndpoint();

          return {
            ...session,
            browserId: browserWSEndpoint.split('/').pop(),
            browserWSEndpoint: browserWSEndpoint
              .replace(port, PORT.toString())
              .replace('127.0.0.1', host),
            devtoolsFrontendUrl: session.devtoolsFrontendUrl
              .replace(port, PORT.toString())
              .replace('127.0.0.1', host),
            port,
            trackingId: browser._trackingId,
            webSocketDebuggerUrl: session.webSocketDebuggerUrl
              .replace(port, PORT.toString())
              .replace('127.0.0.1', host),
          };
        });
    }),
  );

  return _.flatten(results);
};

export const convertUrlParamsToLaunchOpts = (req: IHTTPRequest): ILaunchOptions => {
  const urlParts = req.parsed;
  const args = _.chain(urlParts.query)
    .pickBy((_value, param) => _.startsWith(param, '--'))
    .map((value, key) => `${key}${value ? `=${value}` : ''}`)
    .value();

  const {
    blockAds,
    headless,
    ignoreDefaultArgs,
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

  return {
    args: !_.isEmpty(args) ? args : DEFAULT_LAUNCH_ARGS,
    blockAds: !_.isUndefined(blockAds) || DEFAULT_BLOCK_ADS,
    headless: isHeadless,
    ignoreDefaultArgs: !_.isUndefined(ignoreDefaultArgs) || DEFAULT_IGNORE_DEFAULT_ARGS,
    ignoreHTTPSErrors: !_.isUndefined(ignoreHTTPSErrors) || DEFAULT_IGNORE_HTTPS_ERRORS,
    keepalive,
    pauseOnConnect: !_.isUndefined(pause),
    slowMo: parseInt(slowMo as string, 10) || undefined,
    trackingId: _.isArray(trackingId) ? trackingId[0] : trackingId,
    userDataDir: userDataDir as string || DEFAULT_USER_DATA_DIR,
  };
};

export const launchChrome = async (opts: ILaunchOptions): Promise<IBrowser> => {
  let isUsingTempDataDir = true;
  let browserlessDataDir: string | null = null;

  const launchArgs = {
    ...opts,
    args: [
      ...BROWSERLESS_ARGS,
      ...(opts.args || []),
    ],
    executablePath: CHROME_BINARY_LOCATION,
    handleSIGINT: false,
    handleSIGTERM: false,
  };

  // Having a user-data-dir in args is higher precedence than in opts
  const hasUserDataDir = _.some((launchArgs.args), (arg) => arg.includes('--user-data-dir='));

  if (hasUserDataDir || opts.userDataDir) {
    isUsingTempDataDir = false;
  }

  // If no data-dir is specified, use the default one in opts or generate one
  if (!hasUserDataDir) {
    browserlessDataDir = opts.userDataDir || await getUserDataDir();
    launchArgs.args.push(`--user-data-dir=${browserlessDataDir}`);
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
    }));
};

export const launchChromeDriver = async ({
  blockAds = false,
  trackingId = null,
  pauseOnConnect = false,
}: {
  blockAds: boolean,
  trackingId: null | string,
  pauseOnConnect: boolean,
}) => {
  return new Promise<IChromeDriver>(async (resolve, reject) => {
    const port = await getPort();
    let iBrowser = null;
    const flags = ['--url-base=webdriver', '--verbose', `--port=${port}`, '--whitelisted-ips'];
    debug(`Launching ChromeDriver with args: ${JSON.stringify(flags)}`);

    const chromeProcess: ChildProcess = await chromeDriver.start(flags, true);

    async function onMessage(data: Buffer) {
      const message = data.toString();
      const match = message.match(/DevTools listening on (ws:\/\/.*)/);

      if (match) {
        chromeProcess.stderr && chromeProcess.stderr.off('data', onMessage);
        const [, wsEndpoint] = match;
        debug(`Attaching to chromedriver browser on ${wsEndpoint}`);

        const browser: puppeteer.Browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

        iBrowser = await setupBrowser({
          blockAds,
          browser,
          browserlessDataDir: null,
          isUsingTempDataDir: false,
          keepalive: null,
          pauseOnConnect,
          process: chromeProcess,
          trackingId,
        });
      }
    }

    if (!chromeProcess.stderr) {
      return reject(`Couldn't setup the chromedriver process`);
    }

    chromeProcess.stderr.on('data', onMessage);

    return resolve({
      browser: iBrowser,
      chromeProcess,
      port,
    });
  });
};

export const getChromePath = () => CHROME_BINARY_LOCATION;

export const killAll = async () => {
  await Promise.all(runningBrowsers.map((browser) => closeBrowser(browser)));

  runningBrowsers = [];

  return;
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

    runningBrowsers = runningBrowsers.filter((b) => b.wsEndpoint() !== browser.wsEndpoint());
    browser.removeAllListeners();
    browser.close().catch(_.noop);
  } catch (error) {
    debug(`Browser close emitted an error ${error.message}`);
  } finally {
    debug(`Sending SIGKILL signal to browser process ${browser._browserProcess.pid}`);
    treekill(browser._browserProcess.pid, 'SIGKILL');
  }
};
