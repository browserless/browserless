#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions } = require('../package.json');

(async () => {
  await Promise.all(
    releaseVersions
      .filter((v) => v.includes('puppeteer'))
      .map(
        (version) =>
          $`npm install --silent --save --save-exact puppeteer@${version} && npm run build`,
      ),
  )
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
})();
