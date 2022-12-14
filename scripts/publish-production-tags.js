#!/usr/bin/env zx
/* eslint-disable no-undef */

const { releaseVersions, chromeVersions } = require('../package.json');
const tag = process.env.GITHUB_REF_NAME;

if (!tag) {
  throw new Error(`No $GITHUB_REF_NAME found, exiting`);
}
const [major, minor, patch] = tag.split('.');

if (
  typeof major === 'undefined' ||
  typeof minor === 'undefined' ||
  typeof patch === 'undefined'
) {
  throw new Error(`Tag format must use semantic versioning, eg "1.1.1"`);
}

console.log(
  `Building production versions: ${releaseVersions.join(
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

    const patchBranch = `${major}.${minor}.${patch}-${version}`;
    const minorBranch = `${major}.${minor}-${version}`;
    const majorBranch = `${major}-${version}`;

    try {
      await $`docker buildx build \
      --push \
      --platform ${platforms.join(',')} \
      --build-arg "BASE_VERSION=${version}" \
      --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
      --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
      --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
      -t browserless/chrome:${patchBranch} \
      -t browserless/chrome:${minorBranch} \
      -t browserless/chrome:${majorBranch} .`;
    } catch (err) {
      console.error(
        `Error building for ${version} of puppeteer: ${err.message}`
      );
      process.exit(1);
    }
  }
  console.log(`Successfully built ${releaseVersions.join(', ')} versions!`);
  process.exit(0);
})();
