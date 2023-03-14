#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions, chromeVersions } = require('../package.json');

(async () => {
  const versions = releaseVersions
    .filter((v) => v.includes('puppeteer'))
    .map((v) => v.replace('puppeteer-', ''));

  console.log(`Checking versions ${versions.join(', ')} of puppeteer`);

  for (version of versions) {
    const chromeVersion = chromeVersions[`puppeteer-${version}`].chromeRevision;

    try {
      await $`docker buildx build \
      --load \
      --platform linux/amd64 \
      --build-arg "BASE_VERSION=latest" \
      --build-arg "USE_CHROME_STABLE=false" \
      --build-arg "PUPPETEER_CHROMIUM_REVISION=${chromeVersion}" \
      --build-arg "PUPPETEER_VERSION=${version}" \
      --build-arg "USE_CHROME_STABLE=false" \
      -t browserless/chrome:${version} \
      .`;
      await $`docker run --ipc=host -e CI=true --entrypoint ./test.sh browserless/chrome:${version}`;
    } catch (err) {
      console.error(
        `Error running tests for ${version} of puppeteer: ${err.message}`,
      );
      process.exit(1);
    }
    console.log(`Successfully ran tests for ${versions.join(', ')}!`);
    process.exit(0);
  }
})();
