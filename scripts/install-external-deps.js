const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const extract = require('extract-zip');
const rimraf = require('rimraf');
const puppeteer = require('puppeteer');

const {
  USE_CHROME_STABLE,
  PUPPETEER_CHROMIUM_REVISION,
  PLATFORM,
  WINDOWS,
  MAC,
} = require('../env');

const browserlessTmpDir = path.join(os.tmpdir(), `browserless-devtools-${Date.now()}`);
const devtoolsUrl = `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${PUPPETEER_CHROMIUM_REVISION}%2Fdevtools-frontend.zip?alt=media`;
const chromedriverUrl = PLATFORM === MAC ?
  `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${PUPPETEER_CHROMIUM_REVISION}%2Fchromedriver_mac64.zip?alt=media` :
  PLATFORM === WINDOWS ?
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win%2F${PUPPETEER_CHROMIUM_REVISION}%2Fchromedriver_win32.zip?alt=media` :
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F${PUPPETEER_CHROMIUM_REVISION}%2Fchromedriver_linux64.zip?alt=media`;

const downloadUrlToDirectory = (url, dir) =>
  fetch(url)
    .then((response) => new Promise((resolve, reject) => {
      response.body
        .pipe(fs.createWriteStream(dir))
        .on('error', reject)
        .on('finish', resolve)
    }));

const unzip = (source, target) => new Promise((resolve, reject) => {
  extract(source, { dir: target }, (err) => {
    if (err) {
      reject(err);
    }
    resolve(target);
  });
});

const downloadChromium = () => {
  if (USE_CHROME_STABLE) {
    console.log('Using chrome stable, not proceeding with chromium download');
    return Promise.resolve();
  }

  console.log(`Downloading chromium for revision ${PUPPETEER_CHROMIUM_REVISION}`);

  return puppeteer
    .createBrowserFetcher()
    .download(PUPPETEER_CHROMIUM_REVISION);
};

const downloadChromedriver = () => {
  if (USE_CHROME_STABLE) {
    console.log('chromedriver binary already installed, not proceeding with chromedriver');
    return Promise.resolve();
  }

  console.log(`Downloading chromedriver for revision ${PUPPETEER_CHROMIUM_REVISION}`);

  const chromedriverZipFolder = PLATFORM === MAC ?
    `chromedriver_mac64` :
    PLATFORM === WINDOWS ?
      `chromedriver_win32` :
      `chromedriver_linux64`;
  const chromedriverTmpZip = path.join(browserlessTmpDir, `chromedriver`);
  const chromedriverUnzippedPath = path.join(browserlessTmpDir, chromedriverZipFolder, 'chromedriver');
  const chromedriverFinalPath = path.join(__dirname, '..', 'node_modules', 'chromedriver', 'lib', 'chromedriver', 'chromedriver');

  return downloadUrlToDirectory(chromedriverUrl, chromedriverTmpZip)
    .then(() => unzip(chromedriverTmpZip, browserlessTmpDir))
    .then(() => fs.move(chromedriverUnzippedPath, chromedriverFinalPath, { overwrite: true }))
    .then(() => fs.chmodSync(chromedriverFinalPath, '755'));
};

const downloadDevTools = () => {
  console.log(`Downloading devtools assets for revision ${PUPPETEER_CHROMIUM_REVISION}`);
  const devtoolsTmpZip = path.join(browserlessTmpDir, 'devtools');
  const devtoolsUnzippedPath = path.join(browserlessTmpDir, 'devtools-frontend', 'resources', 'inspector');
  const devtoolsFinalPath = path.join(__dirname, '..', 'debugger', 'devtools');

  return downloadUrlToDirectory(devtoolsUrl, devtoolsTmpZip)
    .then(() => unzip(devtoolsTmpZip, browserlessTmpDir))
    .then(() => fs.move(devtoolsUnzippedPath, devtoolsFinalPath, { overwrite: true }))
};

(async () => {
  try {
    await fs.mkdir(browserlessTmpDir);
    await Promise.all([
      downloadChromium(),
      downloadChromedriver(),
      downloadDevTools(),
    ]);
    console.log('Done unpacking chromedriver and devtools assets');
  } catch(err) {
    console.error(`Error unpacking chromedriver and devtools assets:\n${err.message}\n${err.stack}`);
  } finally {
    rimraf(browserlessTmpDir, () => {});
  }
})();
