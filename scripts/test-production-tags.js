#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions, chromeVersions } = require('../package.json');
const tag = process.env.GITHUB_REF_NAME;

if (!tag) {
  throw new Error(`No $GITHUB_REF_NAME found, exiting`);
}

console.log(
  `Testing versions: ${releaseVersions.join(
    ', '
  )} of browserless/chrome`
);

(async () => {
  for (version of releaseVersions) {
    const versionInfo = chromeVersions[version];
    if (!versionInfo) {
      throw new Error(
        `Couldn't locate version info for puppeteer version ${version}. Did you forget to add it to the package.json?`
      );
    }

    const puppeteerVersion = versionInfo.puppeteer;
    const puppeteerChromiumRevision = versionInfo.chromeRevision;
    const isChromeStable = releaseVersions === 'chrome-stable';
    const chromeStableArg = isChromeStable ? 'true' : 'false';

    try {
      await $`docker build \
      --build-arg "BASE_VERSION=${tag}" \
      --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
      --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
      --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
      -t browserless/chrome:${tag}-${version} .`;

      await $`docker run --ipc=host -e CI=true --entrypoint ./test.sh browserless/chrome:${tag}-${version}`;
    } catch (err) {
      console.error(
        `Error running tests for ${version} of puppeteer: ${err.message}`,
      );
      process.exit(1);
    }
  }
  console.log(`Successfully ran tests for ${releaseVersions.join(', ')}!`);
  process.exit(0);
})();
