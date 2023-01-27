#!/usr/bin/env zx

/* eslint-disable no-undef */
const { map } = require('lodash');

const { releaseVersions, chromeVersions } = require('../package.json');

const version = process.env.GITHUB_REF_NAME;

if (!version) {
  throw new Error(`No $GITHUB_REF_NAME passed in, exiting`);
}

console.log(
  `Building versions: ${releaseVersions.join(
    ', ',
  )}, testing and pushing into docker`,
);

const deployVersion = async (tags, v) => {
  const versionInfo = chromeVersions[v];

  if (!versionInfo) {
    throw new Error(
      `Couldn't locate version info for puppeteer version ${v}. Did you forget to add it to the package.json?`,
    );
  }

  const puppeteerVersion = versionInfo.puppeteer;
  const puppeteerChromiumRevision = versionInfo.chromeRevision;
  const platforms = versionInfo.platforms || ['linux/amd64'];

  const [patchBranch, minorBranch, majorBranch] = tags;
  const isChromeStable = majorBranch.includes('chrome-stable');

  process.env.PUPPETEER_CHROMIUM_REVISION = puppeteerChromiumRevision;
  process.env.USE_CHROME_STABLE = false;
  process.env.CHROMEDRIVER_SKIP_DOWNLOAD = true;
  process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = true;

  if (isChromeStable) {
    process.env.USE_CHROME_STABLE = true;
    process.env.CHROMEDRIVER_SKIP_DOWNLOAD = false;
  }

  const chromeStableArg = isChromeStable ? 'true' : 'false';

  // Since we load the image, we can't run in parallel as it's
  // a known issue atm.
  await Promise.all(
    platforms.map(
      (p) => $`docker buildx build \
  --load \
  --platform ${p} \
  --build-arg "BASE_VERSION=${version}" \
  --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
  --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
  --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
  -t browserless/chrome:${patchBranch} \
  -t browserless/chrome:${minorBranch} \
  -t browserless/chrome:${majorBranch} .`,
    ),
  );

  // Test the image prior to pushing it
  await $`docker run --platform linux/amd64 --ipc=host -e CI=true --entrypoint ./test.sh browserless/chrome:${patchBranch}`;

  await Promise.all([
    $`docker push browserless/chrome:${patchBranch}`,
    $`docker push browserless/chrome:${minorBranch}`,
    $`docker push browserless/chrome:${majorBranch}`,
  ]);
};

(async function deploy() {
  await $`docker buildx build --push --platform linux/amd64,linux/arm64 -t browserless/base:${version} base`;

  const buildVersions = map(releaseVersions, (pV) => {
    const [major, minor, patch] = version.split('.');

    const patchBranch = `${major}.${minor}.${patch}-${pV}`;
    const minorBranch = `${major}.${minor}-${pV}`;
    const majorBranch = `${major}-${pV}`;

    return {
      tags: [patchBranch, minorBranch, majorBranch],
      pV,
    };
  });

  await buildVersions.reduce(
    (lastJob, { tags, pV }) =>
      lastJob
        .then(() => deployVersion(tags, pV))
        .catch((error) => {
          console.log(`Error in build (${version}): `, error);
          process.exit(1);
        }),
    Promise.resolve(),
  );
})();
