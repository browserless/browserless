import * as fs from 'fs';
import * as puppeteer from 'puppeteer';

const { createBrowserFetcher } = require('puppeteer');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';

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
    args: flags.concat(['--no-sandbox', '--disable-dev-shm-usage']),
    executablePath,
  };

  return puppeteer.launch(launchArgs);
};

export const getChromePath = () => executablePath;
