#!/usr/bin/env node
/*
  This script sucks out versioning information out from Chrome
  so that we can label builds nicely in docker and facilitate
  portions of the chrome-remote-protocol API (/json/version and so on)
*/
const _ = require('lodash');
const puppeteer = require('puppeteer');
const url = require('url');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { CHROME_BINARY_LOCATION } = require('../env');

const {
  dependencies: {
    puppeteer: {
      version: puppeteerVersion
    }
  }
} = require('../package-lock.json');

const docsPage = `https://github.com/GoogleChrome/puppeteer/blob/v${puppeteerVersion}/docs/api.md`;
const versionFile = path.join(__dirname, '..', 'version.json');
const protocolFile = path.join(__dirname, '..', 'protocol.json');
const hintsFile = path.join(__dirname, '..', 'hints.json');
const rejectList = path.join(__dirname, '..', 'hosts.json');

let launchArgs = {
  executablePath: CHROME_BINARY_LOCATION,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
};

const getDocs = (docsPage) => [].map.call(
  $('h4').has('a[href^="#page"]')
  .map((i, ele) => {
    const $ele = $(ele);
    const method = ele.innerText.includes('(') ?
      ele.innerText.match(/page\..*(?=\()/g)[0] :
      ele.innerText;
    return {
      text: method.replace('page.', ''),
      description: $ele.nextAll('p').text().substring(0, 350).replace(/(?:\r\n|\r|\n)/g, ' '),
      href: docsPage + $ele.find('a').attr('href'),
      args: $ele.next('ul').html()
    };
  }),
  _ => _);

const getMeta = () => puppeteer
  .launch(launchArgs)
  .then((browser) => {
    console.log(`Chrome launched at path "${CHROME_BINARY_LOCATION}", compiling hints, protocol and version info...`);
    const wsEndpoint = browser.wsEndpoint();
    const { port } = url.parse(wsEndpoint);

    return Promise.all([
      (async() => {
        const page = await browser.newPage();
        const jquery = await page.evaluate(() => window.fetch('https://cdnjs.cloudflare.com/ajax/libs/jquery/3.3.1/jquery.min.js').then((res) => res.text()));
        await page.goto(docsPage);
        await page.evaluate(jquery);
        const hints = await page.evaluate(getDocs, docsPage);

        fs.writeFileSync(
          hintsFile,
          JSON.stringify(hints)
        );
      })(),
      fetch(`http://127.0.0.1:${port}/json/version`)
        .then((res) => res.json())
        .then((meta) => {
          const { 'WebKit-Version': webkitVersion } = meta;

          delete meta.webSocketDebuggerUrl;

          const debuggerVersion = webkitVersion.match(/\s\(@(\b[0-9a-f]{5,40}\b)/)[1];

          fs.writeFileSync(
            versionFile,
            JSON.stringify(Object.assign(
              meta,
              { 'Debugger-Version': debuggerVersion },
              { 'Puppeteer-Version': puppeteerVersion }
            ), null, '  ')
          );
        }),
      fetch(`http://127.0.0.1:${port}/json/protocol`)
        .then((res) => res.json())
        .then((protocol) => {
          fs.writeFileSync(
            protocolFile,
            JSON.stringify(protocol)
          );
        }),
      fetch('https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts')
        .then((res) => res.text())
        .then((raw) =>
          _.chain(raw)
            .split('\n')
            .map((line) => {
              const fragments = line.split(' ');
              if (fragments.length > 1 && fragments[0] === '0.0.0.0') {
                return fragments[1].trim();
              }
              return null
            })
            .reject(_.isNil)
            .value()
        )
        .then((hostsArr) => {
          fs.writeFileSync(
            rejectList,
            JSON.stringify(hostsArr, null, '  ')
          );
        })
    ])
    .then(() => browser.close())
  })
  .catch((error) => {
    console.error(`Issue compiling JSON meta`, error);
    process.exit(1);
  });

if (module.parent) {
  module.exports = getMeta;
} else {
  getMeta();
}
