import { ChildProcess } from 'child_process';
import * as chromeDriver from 'chromedriver';
import * as fs from 'fs';
import * as _ from 'lodash';
import { Browser, LaunchOptions } from 'puppeteer';
import * as url from 'url';
import { canLog, fetchJson, getDebug, sleep, workspaceDir } from './utils';

const puppeteer = require('puppeteer');
const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const DEFAULT_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];

let executablePath: string;
let runningBrowsers: IBrowser[] = [];
const WS_PORT = process.env.PORT;

interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
}

interface IBrowser extends Browser {
  port: string | undefined;
}

export interface ILaunchOptions extends LaunchOptions {
  pauseOnConnect: boolean;
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

export const getDebuggingPages = async (): Promise<any> => {
  const results = await Promise.all(
    runningBrowsers.map(async (browser) => {
      const { port } = url.parse(browser.wsEndpoint());

      const sessions = await fetchJson(`http://127.0.0.1:${port}/json/list`);

      return sessions.map((session) => ({
        ...session,
        devtoolsFrontendUrl: session.devtoolsFrontendUrl.replace(port, WS_PORT),
        port,
        webSocketDebuggerUrl: session.webSocketDebuggerUrl.replace(port, WS_PORT),
      }));
    }),
  );

  return [].concat(...results);
};

export const launchChrome = (opts: ILaunchOptions) => {
  const launchArgs = {
    ...opts,
    args: [...opts.args || [], ...DEFAULT_ARGS],
    executablePath,
    handleSIGTERM: false,
  };

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs)}`);

  return puppeteer.launch(launchArgs).then((browser: IBrowser) => {
    const { port } = url.parse(browser.wsEndpoint());

    browser.once('disconnected', () =>
      runningBrowsers = runningBrowsers.filter((b) => b.wsEndpoint() !== browser.wsEndpoint()),
    );

    browser.on('targetcreated', (target) => {
      return target.type() === 'page' ? target.page()
        .then(async (page) => {
          if (page) {
            if (opts.pauseOnConnect) {
              // @ts-ignore
              await page._client.send('Debugger.enable');
              // @ts-ignore
              await page._client.send('Debugger.pause');
            }
            // @ts-ignore
            return page._client && page._client.send('Page.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath: workspaceDir,
            });
          }
        })
        .catch((err) => debug(`Error setting up page watchers: ${err}`)) :
        Promise.resolve();
    });

    browser.port = port;

    runningBrowsers.push(browser);

    return browser;
  });
};

export const convertUrlParamsToLaunchOpts = (req): ILaunchOptions => {
  const urlParts = url.parse(req.url, true);
  const args = _.chain(urlParts.query)
    .pickBy((_value, param) => _.startsWith(param, '--'))
    .map((value, key) => `${key}${value ? `=${value}` : ''}`)
    .value();

  const {
    headless,
    ignoreDefaultArgs,
    ignoreHTTPSErrors,
    slowMo,
    userDataDir,
    pause,
  } = urlParts.query;

  return {
    args,
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
  return new Promise<IChromeDriver>(async (resolve, reject) => {
    const port = await getPort();

    if (canLog) {
      flags.push('--verbose');
    }

    const chromeProcess = chromeDriver.start([...flags, `--port=${port}`]);

    chromeProcess.stdout.once('data', async () => {
      await sleep(10); // Wait for ports to bind

      resolve({ port, chromeProcess });
    });

    chromeProcess.stderr.once('data', (err) => reject(err));
  });
};

export const getChromePath = () => executablePath;
