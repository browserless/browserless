#!/usr/bin/env zx

/* eslint-disable no-undef */
const { createInterface } = require('readline');

const { map } = require('lodash');
const argv = require('yargs').argv;

const {
  releaseVersions,
  chromeVersions,
  version: npmVersion,
} = require('../package.json');

if (argv.h || argv.help) {
  return console.log(`---
Builds production tags of the browserless/chrome image with options. You can combine these as you wish for complete control.

DEFAULT:
'$ npm run deploy'

Builds a new browserless/base with a version defined in the package.json field and builds then pushes the image into docker.

SET A RELEASE VERSION VERSION:
'$ VERSION=1.2.3 npm run deploy'

Override the package.json version, used in the first part of our version semantics. Builds the base and chrome repos, pushing after success.

SKIP BASE BUILDS:
'$ npm run deploy -- --skipBase'

Skips building the base layer. Note that you'll still need a browserless/base:$VERSION available.

SPECIFY A PUPPETEER VERSION:
'$ npm run deploy -- --versions=puppeteer-1.20.0,puppeteer-20.2.1'

Releases only a specific version, and has to be included in the 'releaseVersions' property of the package.json file. Comma-separated lists only.

SPECIFY A SPECIFIC PLATFORM:
'$ npm run deploy -- --platform=linux/arm64'

Releases only a specific platform for each release version. Supports linux/arm64 and linux/amd64 platforms at the moment. If a prior tag has
been made this *will* override it possibly removing the prior platform.
---`);
}

const version = process.env.VERSION ?? npmVersion;
const buildBase = !argv.skipBase;
const requestedPlatform = argv.platform;
const requestedVersions = argv.versions
  ? argv.versions.split(',')
  : releaseVersions;
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

if (
  requestedPlatform &&
  !['linux/amd64', 'linux/arm64'].includes(requestedPlatform)
) {
  console.warn(
    `Unsupported --platform switch. 'linux/amd64' or 'linux/arm64' only are supported.`,
  );
}

const prompt = (question) => {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
};

// LOG...
const work = [
  buildBase
    ? `Building ""browserless/base:${version}" on platform ${
        requestedPlatform ?? 'all platforms'
      }`
    : null,
  `Building ${requestedVersions.join(', ')} on platform ${
    requestedPlatform ?? 'all platforms'
  }`,
];

console.log(work.filter((_) => !!_).join('.\n'));

const deployVersion = async (tags, v) => {
  const versionInfo = chromeVersions[v];

  if (!versionInfo) {
    throw new Error(
      `Couldn't locate version info for puppeteer version ${v}. Did you forget to add it to the package.json?`,
    );
  }

  const puppeteerVersion = versionInfo.puppeteer;
  const puppeteerChromiumRevision = versionInfo.chromeRevision;
  const platforms = requestedPlatform
    ? [requestedPlatform]
    : versionInfo.platforms || ['linux/amd64'];

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
};

(async function deploy() {
  // Wait 30 seconds before proceeding to allow folks to verify.
  const answer = await prompt('\nProceed (y/n)?');

  if (answer !== 'y' && answer !== 'yes') {
    return;
  }

  if (buildBase) {
    const basePlatform = requestedPlatform ?? 'linux/amd64,linux/arm64';
    await $`docker buildx build --push --platform ${basePlatform} -t browserless/base:${version} base`;
  }

  const buildVersions = map(requestedVersions, (pV) => {
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

  console.log(`Complete! Make sure to run 'docker system prune' sometimes ;)`);
  process.exit(0);
})();
