import { ChildProcess } from 'child_process';
// @ts-ignore no types
import * as chromeDriver from 'chromedriver';
import * as express from 'express';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as _ from 'lodash';
import * as puppeteer from 'puppeteer';
import * as url from 'url';
import { fetchJson, getDebug, getUserDataDir, rimraf } from './utils';

import {
  DEFAULT_BLOCK_ADS,
  DEFAULT_HEADLESS,
  DEFAULT_IGNORE_DEFAULT_ARGS,
  DEFAULT_IGNORE_HTTPS_ERRORS,
  DEFAULT_LAUNCH_ARGS,
  DEFAULT_USER_DATA_DIR,
  DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR,
  ENABLE_DEBUG_VIEWER,
  HOST,
  PORT,
  WORKSPACE_DIR,
} from './config';

const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const BROWSERLESS_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];
const blacklist = require('../hosts.json');

export let executablePath: string;
let runningBrowsers: IBrowser[] = [];

export interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
}

interface IBrowser extends puppeteer.Browser {
  port?: string | undefined;
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
}

export interface ILaunchOptions extends puppeteer.LaunchOptions {
  pauseOnConnect: boolean;
  blockAds: boolean;
}

const defaultDriverFlags = ['--url-base=webdriver', '--verbose'];

if (fs.existsSync(CHROME_BINARY_LOCATION)) {
  // If it's installed already, consume it
  executablePath = CHROME_BINARY_LOCATION;
} else {
  // Use puppeteer's copy otherwise
  const browserFetcher = puppeteer.createBrowserFetcher();
  const revisionInfo = browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision);
  executablePath = revisionInfo.executablePath;
}

const setupPage = async ({
  page,
  pauseOnConnect,
  blockAds,
}: {
  page: puppeteer.Page;
  pauseOnConnect: boolean;
  blockAds: boolean;
}) => {
  const client = _.get(page, '_client', _.noop);

  if (!DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR) {
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: WORKSPACE_DIR,
    });
  }

  if (pauseOnConnect && ENABLE_DEBUG_VIEWER) {
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
}: {
  browser: IBrowser;
  isUsingTempDataDir: boolean;
  browserlessDataDir?: string | null;
  blockAds: boolean;
  pauseOnConnect: boolean;
}): Promise<IBrowser> => {
  const { port } = url.parse(browser.wsEndpoint());

  browser.once('disconnected', () => {
    if (isUsingTempDataDir && browserlessDataDir) {
      debug(`Removing temp data-dir ${browserlessDataDir}`);
      rimraf(browserlessDataDir);
    }

    runningBrowsers = runningBrowsers.filter((b) => b.wsEndpoint() !== browser.wsEndpoint());
    browser.removeAllListeners();
  });

  browser.on('targetcreated', async (target) => {
    try {
      const page = await target.page();

      if (page && !page.isClosed()) {
        // @ts-ignore
        setupPage({
          blockAds,
          page,
          pauseOnConnect,
        });
      }
    } catch (error) {
      debug(`Error setting up new browser`, error);
    }
  });

  const pages = await browser.pages();
  pages.forEach((page) => setupPage({ blockAds, page, pauseOnConnect }));

  runningBrowsers.push(browser);

  browser.port = port;
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

export const getRandomSession = () => _.sample(runningBrowsers) as IBrowser | undefined;

export const findSessionForPageUrl = async (pathname: string) => {
  const pages = await getDebuggingPages();

  return pages.find((session) => session.devtoolsFrontendUrl.includes(pathname));
};

export const getDebuggingPages = async (): Promise<ISession[]> => {
  const results = await Promise.all(
    runningBrowsers.map(async (browser) => {
      const endpoint = browser.wsEndpoint();
      const { port } = url.parse(endpoint);
      const host = HOST || '127.0.0.1';

      if (!port) {
        throw new Error('Error locating port in browser endpoint: ${endpoint}');
      }

      const sessions: ISession[] = await fetchJson(`http://127.0.0.1:${port}/json/list`);

      return sessions
        .filter(({ title }) => title !== 'about:blank')
        .map((session) => ({
          ...session,
          port,

          devtoolsFrontendUrl: session.devtoolsFrontendUrl
            .replace(port, PORT.toString())
            .replace('127.0.0.1', host),
          webSocketDebuggerUrl: session.webSocketDebuggerUrl
            .replace(port, PORT.toString())
            .replace('127.0.0.1', host),
        }));
    }),
  );

  return _.flatten(results);
};

export const launchChrome = async (opts: ILaunchOptions): Promise<puppeteer.Browser> => {
  let isUsingTempDataDir = true;
  let browserlessDataDir: string | null = null;

  const launchArgs = {
    ...opts,
    args: [
      ...BROWSERLESS_ARGS,
      ...(opts.args || []),
    ],
    executablePath,
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
      pauseOnConnect: opts.pauseOnConnect,
    }));
};

export const convertUrlParamsToLaunchOpts = (req: IncomingMessage | express.Request): ILaunchOptions => {
  const urlParts = url.parse(req.url || '', true);
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
  } = urlParts.query;

  const isHeadless = !_.isUndefined(headless) ?
    headless !== 'false' :
    DEFAULT_HEADLESS;

  return {
    args: !_.isEmpty(args) ? args : DEFAULT_LAUNCH_ARGS,
    blockAds: !_.isUndefined(blockAds) || DEFAULT_BLOCK_ADS,
    headless: isHeadless,
    ignoreDefaultArgs: !_.isUndefined(ignoreDefaultArgs) || DEFAULT_IGNORE_DEFAULT_ARGS,
    ignoreHTTPSErrors: !_.isUndefined(ignoreHTTPSErrors) || DEFAULT_IGNORE_HTTPS_ERRORS,
    pauseOnConnect: !_.isUndefined(pause),
    slowMo: parseInt(slowMo as string, 10) || undefined,
    userDataDir: userDataDir as string || DEFAULT_USER_DATA_DIR,
  };
};

export const launchChromeDriver = async (flags: string[] = defaultDriverFlags) => {
  debug(`Launching ChromeDriver with args: ${JSON.stringify(flags)}`);

  return new Promise<IChromeDriver>(async (resolve) => {
    const port = await getPort();

    const chromeProcess: ChildProcess = await chromeDriver.start(
      [...flags, `--port=${port}`, '--whitelisted-ips'],
      true,
    );

    async function onMessage(data: Buffer) {
      const message = data.toString();
      const match = message.match(/DevTools listening on (ws:\/\/.*)/);

      if (match) {
        chromeProcess.stderr && chromeProcess.stderr.off('data', onMessage);
        const [, wsEndpoint] = match;
        const { port } = url.parse(wsEndpoint);
        debug(`Attaching to chromedriver browser on ${port}`);

        const browser: IBrowser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });

        setupBrowser({
          blockAds: false,
          browser,
          isUsingTempDataDir: false,
          pauseOnConnect: false,
        });
      }
    }

    chromeProcess.stderr && chromeProcess.stderr.on('data', onMessage);

    return resolve({
      chromeProcess,
      port,
    });
  });
};

export const getChromePath = () => executablePath;
