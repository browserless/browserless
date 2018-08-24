import * as fs from 'fs';
import * as puppeteer from 'puppeteer';
import { getDebug } from './utils';

const debug = getDebug('chrome-helper');
const { createBrowserFetcher } = require('puppeteer');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const DEFAULT_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--enable-logging', '--v1=1'];

let executablePath: string;

if (fs.existsSync(CHROME_BINARY_LOCATION)) {
  // If it's installed already, consume it
  executablePath = CHROME_BINARY_LOCATION;
} else {
  // Use puppeteer's copy otherwise
  const browserFetcher = createBrowserFetcher();
  const revisionInfo = browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision);
  executablePath = revisionInfo.executablePath;
}

export const launchChrome = (flags: string[] = []) => {
  const launchArgs: puppeteer.LaunchOptions = {
    args: [...flags, ...DEFAULT_ARGS],
    executablePath,
  };

  debug(`Launching Chrome with args: ${JSON.stringify(launchArgs)}`);

  return puppeteer.launch(launchArgs);
};

export const getChromePath = () => executablePath;
