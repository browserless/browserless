#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions } = require('../package.json');

(async () => {
  const versions = releaseVersions
    .filter((v) => v.includes('puppeteer'))
    .map((v) => v.replace('puppeteer-', ''));

  console.log(`Checking versions ${versions.join(', ')} of puppeteer`);

  for (version of versions) {
    await $`npm install --silent --save --save-exact puppeteer@${version} && npm run build`;
  }
})();
