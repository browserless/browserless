#!/usr/bin/env node

/*
  This script sucks out versioning information out from Chrome
  so that we can label builds nicely in docker and facilitate
  portions of the chrome-remote-protocol API (/json/version and so on)
*/
const puppeteer = require('puppeteer');
const url = require('url');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const {
  dependencies: {
    puppeteer: {
      version: puppeteerVersion
    }
  }
} = require('../package-lock.json');

const versionFile = path.join(__dirname, '..', 'version.json');
const protocolFile = path.join(__dirname, '..', 'protocol.json');

puppeteer
  .launch()
  .then((browser) => {
    const wsEndpoint = browser.wsEndpoint();
    const { port } = url.parse(wsEndpoint);

    return Promise.all([
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
        })
    ])
    .then(() => browser.close())
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
