/*
  ChromeDriver:
  Linux: https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F662092%2Fchromedriver_linux64.zip?alt=media
  Mac: https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Mac/
  Windows: https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Win/

  DevTools:
  Mac: https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F672088%2Fdevtools-frontend.zip?alt=media
*/
const os = require('os');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const unzipper = require('unzipper');
const rimraf = require('rimraf');

const {
  puppeteer: {
    chromium_revision,
  },
} = require('puppeteer/package.json');

const platform = os.platform();

const chromedriverDownloadPath = path.join(__dirname, '..', 'node_modules', 'chromedriver', 'lib', 'chromedriver');
const devtoolsDownloadPath = path.join(__dirname, '..', 'debugger');

const devtoolsTmpPath = path.join(os.tmpdir(), 'browserless-devtools');

const chromedriverZipFolder = platform === 'darwin' ?
  `chromedriver_mac64` :
  platform === 'win32' ?
    `chromedriver_win32` :
    `chromedriver_linux64`;

const chromedriverUrl = platform === 'darwin' ?
  `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${chromium_revision}%2Fchromedriver_mac64.zip?alt=media` :
  platform === 'win32' ?
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win%2F${chromium_revision}%2Fchromedriver_win32.zip?alt=media` :
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F${chromium_revision}%2Fchromedriver_linux64.zip?alt=media`;

const devtoolsUrl = `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${chromium_revision}%2Fdevtools-frontend.zip?alt=media`

const downloadChromedriver = () => {
  if (process.env.CHROMEDRIVER_SKIP_DOWNLOAD) {
    console.log('Chromedriver binary already downloaded, exiting');
    return Promise.resolve();
  }
  const chromedriverZipDir = path.join(chromedriverDownloadPath, chromedriverZipFolder);
  const chromedriverUnzippedPath = path.join(chromedriverZipDir, 'chromedriver');
  const chromedriverFinalPath = path.join(chromedriverDownloadPath, 'chromedriver');

  return fetch(chromedriverUrl)
  .then((response) => new Promise((resolve, reject) => {
    console.log(`Chromedriver download finished, unzipping...`);
    response.body
      .pipe(unzipper.Extract({ path: chromedriverDownloadPath }))
      .on('error', reject)
      .on('finish', resolve)
  }))
  .then(() => fs.renameSync(chromedriverUnzippedPath, chromedriverFinalPath))
  .then(() => fs.chmodSync(chromedriverFinalPath, '755'));
};

const downloadDevTools = () => {
  const devtoolsUnzippedPath = path.join(devtoolsTmpPath, 'devtools-frontend', 'resources', 'inspector');
  const devtoolsFinalPath = path.join(devtoolsDownloadPath, 'devtools');

  return fetch(devtoolsUrl)
  .then((response) => new Promise((resolve, reject) => {
    console.log(`Devtools download finished, unzipping...`);
    response.body
      .pipe(unzipper.Extract({ path: devtoolsTmpPath }))
      .on('error', reject)
      .on('finish', resolve)
  }))
  .then(() => fs.renameSync(devtoolsUnzippedPath, devtoolsFinalPath))
  .then(() => new Promise((resolve, reject) => {
    rimraf(devtoolsTmpPath, (err) => {
      if (err) {
        return reject(`Error removing temporary folder ${devtoolsTmpPath}: ${err.message}`);
      }
      resolve();
    });
  }))
};

Promise.all([
  downloadChromedriver(),
  downloadDevTools(),
])
.then(() => console.log('Done unpacking external dependencies'))
.catch((err) => console.error(`Error unpacking external dependencies:\n${err.message}`));
