/*
Linux: https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F662092%2Fchromedriver_linux64.zip?alt=media
Mac: https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Mac/
Windows: https://commondatastorage.googleapis.com/chromium-browser-snapshots/index.html?prefix=Win/
*/
const os = require('os');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const unzipper = require('unzipper');

const {
  puppeteer: {
    chromium_revision,
  },
} = require('puppeteer/package.json');

const platform = os.platform();
const downloadPath = path.join(__dirname, '..', 'node_modules', 'chromedriver', 'lib', 'chromedriver');

const zipFolder = platform === 'darwin' ?
  `chromedriver_mac64` :
  platform === 'win32' ?
    `chromedriver_win32` :
    `chromedriver_linux64`;

const downloadURL = platform === 'darwin' ?
  `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Mac%2F${chromium_revision}%2Fchromedriver_mac64.zip?alt=media` :
  platform === 'win32' ?
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Win%2F${chromium_revision}%2Fchromedriver_win32.zip?alt=media` :
    `https://www.googleapis.com/download/storage/v1/b/chromium-browser-snapshots/o/Linux_x64%2F${chromium_revision}%2Fchromedriver_linux64.zip?alt=media`;

const zipDir = path.join(downloadPath, zipFolder);
const unzippedPath = path.join(zipDir, 'chromedriver');
const finalPath = path.join(downloadPath, 'chromedriver');

console.log(`Downloading chromedriver for rev ${chromium_revision}:
URL: ${downloadURL}
Binary Location: ${downloadPath}`);

fetch(downloadURL)
  .then((response) => new Promise((resolve, reject) => {
    console.log(`Download finished, unzipping...`);
    response.body
      .pipe(unzipper.Extract({ path: downloadPath }))
      .on('error',reject)
      .on('finish',resolve)
  }))
  .then(() => fs.renameSync(unzippedPath, finalPath))
  .then(() => fs.chmodSync(finalPath, '755'));
