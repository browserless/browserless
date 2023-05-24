#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions, chromeVersions } = require('../package.json');

(async () => {
  const puppeteerVersions =
    (await question(
      `Which puppeteer versions do you want to test (Must be contained package.json "releaseVersions" and defaults to that list)? `,
    )) || releaseVersions.join(',');

    const requestedVersions = puppeteerVersions.split(',');

    const missingVersions = requestedVersions.filter(
      (v) => !releaseVersions.includes(v),
    );

    // Validate arg parsing
    if (missingVersions.length) {
      throw new Error(
        `Versions: ${missingVersions.join(
          ', ',
        )} are missing from the package.json file manifest. Please double check your versions`,
      );
    }

  console.log(`Checking versions ${requestedVersions.join(', ')} of puppeteer`);

  for (version of requestedVersions) {
    const chromeVersion = chromeVersions[version].chromeRevision;

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
  }
  console.log(`Successfully ran tests for ${versions.join(', ')}!`);
  process.exit(0);
})();
