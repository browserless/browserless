import { ChildProcess } from 'child_process';
import * as chromeDriver from 'chromedriver';
import * as fs from 'fs';
import { canLog, getDebug, sleep } from './utils';

const puppeteer = require('puppeteer');
const debug = getDebug('chrome-helper');
const getPort = require('get-port');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const DEFAULT_ARGS = ['--disable-dev-shm-usage', '--enable-logging', '--v1=1'];

// Sandboxing requires a custom seccomp.json file, which is a breaking change
// This will drop in v1.0.0
if (process.env.ENABLE_SANDBOX !== 'true') {
  DEFAULT_ARGS.push('--no-sandbox');
}

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

export const launchChrome = (
  { flags, headless }:
  { flags: string[], headless: boolean },
) => {
  const launchArgs = {
    args: [...flags, ...DEFAULT_ARGS],
    executablePath,
    headless,
  };

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs)}`);

  return puppeteer.launch(launchArgs);
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
