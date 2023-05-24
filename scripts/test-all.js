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
    const versionInfo = chromeVersions[version];

    if (!versionInfo) {
      throw new Error(
        `Couldn't locate version info for puppeteer version "${version}". Did you forget to add it to the package.json?`,
      );
    }
    const puppeteerChromiumRevision = versionInfo.chromeRevision;
    const puppeteerVersion = versionInfo.puppeteer;
    const isChromeStable = version.includes('chrome-stable').toString();

    try {
      await $`docker buildx build \
      --load \
      --platform linux/amd64 \
      --build-arg "BASE_VERSION=latest" \
      --build-arg "BASE_REPO=browserless/base" \
      --build-arg "USE_CHROME_STABLE=${isChromeStable}" \
      --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
      --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
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
  console.log(`Successfully ran tests for ${requestedVersions.join(', ')}!`);
  process.exit(0);
})();
