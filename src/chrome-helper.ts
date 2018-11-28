import { ChildProcess } from 'child_process';
import * as chromeDriver from 'chromedriver';
import * as fs from 'fs';
import * as _ from 'lodash';
import { LaunchOptions } from 'puppeteer';
import * as url from 'url';
import { canLog, getDebug, sleep } from './utils';

const puppeteer = require('puppeteer');
const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const DEFAULT_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];

let executablePath: string;

interface IChromeDriver {
  port: number;
  chromeProcess: ChildProcess;
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
  args: undefined,
  headless: true,
  ignoreDefaultArgs: false,
  ignoreHTTPSErrors: false,
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

export const launchChrome = (opts: LaunchOptions) => {
  const launchArgs = {
    ...opts,
    args: [...opts.args || [], ...DEFAULT_ARGS],
    executablePath,
  };

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs)}`);

  return puppeteer.launch(launchArgs);
};

export const convertUrlParamsToLaunchOpts = (req): LaunchOptions => {
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
  } = urlParts.query;

  return {
    args,
    headless: headless !== 'false',
    ignoreDefaultArgs: ignoreDefaultArgs ?
      parseIgnoreDefaultArgs(ignoreDefaultArgs) :
      false,
    ignoreHTTPSErrors: ignoreHTTPSErrors === 'true',
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
