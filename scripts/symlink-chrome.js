const fs = require('fs');
const { promisify } = require('util');
const { exec: nodeExec } = require('child_process');
const execAsync = promisify(nodeExec);

const puppeteer = require('puppeteer');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';
const IS_DOCKER = fs.existsSync('/.dockerenv');

const exec = async (command) => {
  const { stdout, stderr } = await execAsync(command);

  if (stderr.trim().length) {
    console.error(stderr);
    return process.exit(1);
  }

  return stdout.trim();
};

// This is used in docker to symlink the puppeteer's
// chrome to a place where most other libraries expect it
// (IE: WebDriver) without having to specify it
if (!IS_DOCKER) {
  console.error('"npm run symlink" is only meant to be executed inside of docker.');
  process.exit(1);
}

const browserFetcher = puppeteer.createBrowserFetcher();
const { executablePath } = browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision);

(async () => fs.existsSync(CHROME_BINARY_LOCATION) ?
  Promise.resolve() :
  exec(`ln -s ${executablePath} ${CHROME_BINARY_LOCATION}`)
)();
