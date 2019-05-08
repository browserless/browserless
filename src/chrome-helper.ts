import { ChildProcess } from 'child_process';
// @ts-ignore no types
import * as chromeDriver from 'chromedriver';
import * as express from 'express';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
import * as _ from 'lodash';
import { Browser, LaunchOptions } from 'puppeteer';
import * as url from 'url';
import { DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR, ENABLE_DEBUG_VIEWER, PORT, WORKSPACE_DIR } from './config';
import { canLog, fetchJson, getDebug, getUserDataDir, rimraf } from './utils';

const puppeteer = require('puppeteer');
const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const DEFAULT_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];
const blacklist = require('../hosts.json');

let executablePath: string;
let runningBrowsers: IBrowser[] = [];

export interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
}

interface IBrowser extends Browser {
  port: string | undefined;
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

export interface ILaunchOptions extends LaunchOptions {
  pauseOnConnect: boolean;
  blockAds: boolean;
}

const defaultDriverFlags = ['--url-base=webdriver'];

if (fs.existsSync(CHROME_BINARY_LOCATION)) {
  // If it's installed already, consume it
  executablePath = CHROME_BINARY_LOCATION;
} else {
  // Use puppeteer's copy otherwise
  const browserFetcher = puppeteer.createBrowserFetcher();
  const revisionInfo = browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision);
  executablePath = revisionInfo.executablePath;
}

export const defaultLaunchArgs = {
  args: [],
  blockAds: false,
  headless: true,
  ignoreDefaultArgs: false,
  ignoreHTTPSErrors: false,
  pauseOnConnect: false,
  slowMo: undefined,
  userDataDir: undefined,
};

const parseIgnoreDefaultArgs = (argsString: string | string[]): boolean | string[] => {
  if (Array.isArray(argsString)) {
    return argsString;
  }

  if (argsString === 'true' || argsString === 'false') {
    return argsString === 'true';
  }

  if (argsString.includes(',')) {
    return argsString.split(',');
  }

  return false;
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

      if (!port) {
        throw new Error('Error locating port in browser endpoint: ${endpoint}');
      }

      const sessions: ISession[] = await fetchJson(`http://127.0.0.1:${port}/json/list`);

      return sessions.map((session) => ({
        ...session,
        devtoolsFrontendUrl: session.devtoolsFrontendUrl.replace(port, PORT.toString()),
        port,
        webSocketDebuggerUrl: session.webSocketDebuggerUrl.replace(port, PORT.toString()),
      }));
    }),
  );

  return _.flatten(results);
};

export const launchChrome = async (opts: ILaunchOptions): Promise<Browser> => {
  let browserlessDataDir: string | null = null;
  const launchArgs = {
    ...opts,
    args: [...opts.args || [], ...DEFAULT_ARGS],
    executablePath,
    handleSIGINT: false,
    handleSIGTERM: false,
  };

  const hasUserDataDir = _.some((launchArgs.args), (arg) => arg.includes('--user-data-dir='));

  // If no data-dir is set, build one that is managed by us and cleanedup after
  if (!hasUserDataDir) {
    browserlessDataDir = await getUserDataDir();
    launchArgs.args.push(`--user-data-dir=${browserlessDataDir}`);
  }

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs, null, '  ')}`);

  return puppeteer.launch(launchArgs).then((browser: IBrowser) => {
    const { port } = url.parse(browser.wsEndpoint());

    browser.once('disconnected', () => {
      if (browserlessDataDir) {
        rimraf(browserlessDataDir);
      }

      runningBrowsers = runningBrowsers.filter((b) => b.wsEndpoint() !== browser.wsEndpoint());
    });

    if (!DISABLE_AUTO_SET_DOWNLOAD_BEHAVIOR) {
      browser.on('targetcreated', async (target) => {
        try {
          const page = await target.page();

          if (page && !page.isClosed()) {
            // @ts-ignore
            const client = page._client;
            if (opts.pauseOnConnect && ENABLE_DEBUG_VIEWER) {
              await client.send('Debugger.enable');
              await client.send('Debugger.pause');
            }
            if (opts.blockAds) {
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
            client.send('Page.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath: WORKSPACE_DIR,
            }).catch((error: Error) => debug(`Error setting download paths`, error));
          }
        } catch (error) {
          debug(`Error setting download paths`, error);
        }
      });
    }

    browser.port = port;

    runningBrowsers.push(browser);

    return browser;
  });
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

  return {
    args,
    blockAds: typeof blockAds !== 'undefined',
    headless: headless !== 'false',
    ignoreDefaultArgs: ignoreDefaultArgs ?
      parseIgnoreDefaultArgs(ignoreDefaultArgs) :
      false,
    ignoreHTTPSErrors: ignoreHTTPSErrors === 'true',
    pauseOnConnect: typeof pause !== 'undefined',
    slowMo: parseInt(slowMo as string, 10) || undefined,
    userDataDir: userDataDir as string,
  };
};

export const launchChromeDriver = async (flags: string[] = defaultDriverFlags) => {
  debug(`Launching ChromeDriver with args: ${JSON.stringify(flags)}`);

  return new Promise<IChromeDriver>(async (resolve) => {
    const port = await getPort();

    if (canLog) {
      flags.push('--verbose');
    }

    const chromeProcess = await chromeDriver.start([...flags, `--port=${port}`, '--whitelisted-ips'], true);

    return resolve({
      chromeProcess,
      port,
    });
  });
};

export const getChromePath = () => executablePath;
