const os = require('os');
const puppeteer = require('puppeteer');
const pptrPackageJSON = require('puppeteer/package.json');
const pptrVersion = pptrPackageJSON.version;

const packageJson = require('./package.json');
const IS_DOCKER = process.env.IS_DOCKER === 'true';

const USE_CHROME_STABLE = process.env.USE_CHROME_STABLE && process.env.USE_CHROME_STABLE === 'true';

const MAC = 'MAC';
const WINDOWS = 'WINDOWS';
const LINUX = 'LINUX';

const CHROME_BINARY_PATHS = {
  LINUX: '/usr/bin/google-chrome',
  MAC: '/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome',
  WIN: 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
};

const PLATFORM = os.platform() === 'win32' ?
  WINDOWS :
    os.platform() === 'darwin' ?
      MAC :
      LINUX;

/*
 * Assess which chromium revision to install.
 * Note that in docker we do our own install, and
 * ignore puppeteer's install.js file.
 */
const PUPPETEER_CHROMIUM_REVISION = (() => {
  if (process.env.PUPPETEER_CHROMIUM_REVISION) {
    return process.env.PUPPETEER_CHROMIUM_REVISION;
  }

  if (USE_CHROME_STABLE) {
    return packageJson.puppeteerVersions['chrome-stable'].chromeRevision;
  }

  const pinnedRevision = packageJson.puppeteerVersions[`puppeteer-${pptrVersion}`];

  if (pinnedRevision) {
    return pinnedRevision.chromeRevision
  }

  if (pptrPackageJSON.puppeteer) {
    return pptrPackageJSON.puppeteer.chromium_revision;
  }


  if (puppeteer._preferredRevision) {
    return puppeteer._preferredRevision;
  }

  return require('puppeteer/lib/cjs/revisions').PUPPETEER_REVISIONS.chromium;
})();

/*
 * Sometimes we don't use puppeteer's built-in chromium
 * for compatibility reasons
 */
const PUPPETEER_BINARY_LOCATION = (() => {
  // Use the copy that comes with puppeteer otherwise
  const browserFetcher = puppeteer.createBrowserFetcher();
  return browserFetcher.revisionInfo(PUPPETEER_CHROMIUM_REVISION).executablePath;
})();

/*
 * Tells puppeteer, in its install script, what revision to download.
 * This is set in our deploy.js file in our docker build. If
 * PUPPETEER_SKIP_CHROMIUM_DOWNLOAD is true, then this is ignored
 */
const CHROME_BINARY_LOCATION = (() => {
  if (process.env.CHROME_BINARY_LOCATION) {
    return process.env.CHROME_BINARY_LOCATION;
  }

  // In docker we symlink any chrome installs to the default install location
  // so that chromedriver can do its thing
  if (IS_DOCKER) {
    return CHROME_BINARY_PATHS.LINUX;
  }

  // If using chrome-stable, default to it's natural habitat
  if (USE_CHROME_STABLE) {
    return CHROME_BINARY_PATHS[PLATFORM];
  }

  // All else uses pptr's bin
  return PUPPETEER_BINARY_LOCATION;
})();

/*
 * Tells the chromedriver library to download the appropriate chromedriver binary.
 * The only time this should be false is when building chrome stable in docker.
 */
const CHROMEDRIVER_SKIP_DOWNLOAD = (() => {
  if (process.env.CHROMEDRIVER_SKIP_DOWNLOAD) {
    return process.env.CHROMEDRIVER_SKIP_DOWNLOAD;
  }

  if (IS_DOCKER) {
    return !USE_CHROME_STABLE;
  }

  return true;
})();

/*
 * Tells puppeteer to skip downloading the appropriate chrome revision. This is generally
 * not the case, however when installing chrome-stable in docker we want to skip it as
 * we'll download google-chrome-stable from a deb package instead.
 */
const PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = (() => {
  if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD) {
    return process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
  }

  if (IS_DOCKER) {
    return USE_CHROME_STABLE;
  }

  return false;
})();

module.exports = {
  IS_DOCKER,
  USE_CHROME_STABLE,
  PUPPETEER_CHROMIUM_REVISION,
  CHROME_BINARY_LOCATION,
  CHROMEDRIVER_SKIP_DOWNLOAD,
  PUPPETEER_SKIP_CHROMIUM_DOWNLOAD,
  PUPPETEER_BINARY_LOCATION,
  PLATFORM,
  WINDOWS,
  MAC,
  LINUX,
};
