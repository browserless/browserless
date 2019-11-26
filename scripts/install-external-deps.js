const os = require('os');
const path = require('path');
const fs = require('fs-extra');
const fetch = require('node-fetch');
const extract = require('extract-zip');
const rimraf = require('rimraf');

const platform = os.platform();
const browserlessTmpDir = path.join(os.tmpdir(), `browserless-devtools-${Date.now()}`);

const { puppeteer: { chromium_revision } } = require('puppeteer/package.json');

const chromedriverUrl = platform === 'darwin' ?
  `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${chromium_revision}%2Fchromedriver_mac64.zip?alt=media` :
  platform === 'win32' ?
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win%2F${chromium_revision}%2Fchromedriver_win32.zip?alt=media` :
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F${chromium_revision}%2Fchromedriver_linux64.zip?alt=media`;

const devtoolsUrl = `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${chromium_revision}%2Fdevtools-frontend.zip?alt=media`

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

const downloadChromedriver = () => {
  if (process.env.CHROMEDRIVER_SKIP_DOWNLOAD === 'false') {
    console.log('Chromedriver binary already downloaded, exiting');
    return Promise.resolve();
  }

  const chromedriverZipFolder = platform === 'darwin' ?
    `chromedriver_mac64` :
    platform === 'win32' ?
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
      downloadChromedriver(),
      downloadDevTools(),
    ]);
    console.log('Done unpacking external dependencies');
  } catch(err) {
    console.error(`Error unpacking external dependencies:\n${err.message}\n${err.stack}`);
  } finally {
    rimraf(browserlessTmpDir, () => {});
  }
})();
