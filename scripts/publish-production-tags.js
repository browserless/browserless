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
const allowedActions = ['test', 'push'];

if (argv.h || argv.help) {
  return console.log(`---
Builds production tags of the browserless/chrome image with options. You can combine these as you wish for complete control.

DEFAULT:
'$ npm run deploy'

Builds a new browserless/base with a version defined in the package.json field and builds, tests then pushes the image into docker.

SET A RELEASE VERSION VERSION:
'$ VERSION=1.2.3 npm run deploy'

Override the package.json version, and build base then build, test, and push the versions.

SKIP TESTS:
'$ npm run deploy -- --action=push'

Skips testing and pushes after successful building, similar to 'buildx --push' commands.

SKIP PUSH:
'$ npm run deploy -- --action=test'

Skips pushing and simply tests the completed builds.

SKIP BASE BUILDS:
'$ npm run deploy -- --skipBase'

Skips building the base layer. Note that you'll still need a browserless/base:$VERSION available.

SPECIFY A PUPPETEER VERSION:
'$ npm run deploy -- --versions=puppeteer-1.20.0,puppeteer-20.2.1'

Releases only a specific version, and has to be included in the 'releaseVersions' property of the package.json file. Comma-separated lists only.

SPECIFY A SPECIFIC PLATFORM:
'$ npm run deploy -- --platform=linux/arm64'

Releases only a specific platform for each release version. Supports linux/arm64 and linux/amd64 platforms at the moment.
---`);
}

const version = process.env.VERSION ?? npmVersion;
const buildBase = !argv.skipBase;
const requestedPlatform = argv.platform;
const requestedActions = argv.actions ? argv.action.split(',') : allowedActions;
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

if (requestedActions.some((action) => !allowedActions.includes(action))) {
  throw new Error(`--actions must only be ${allowedActions.join(',')}.`);
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
  requestedActions.includes('test') ? 'Testing these versions' : null,
  requestedActions.includes('push') ? 'Pushing these versions' : null,
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
  const shouldTest = requestedActions.includes('test');
  const shouldPush = requestedActions.includes('push');
  const pushOnly = !shouldTest && shouldPush;
  const initialAction = pushOnly ? '--push' : '--load';

  // Since we load the image, we can't run in parallel as it's
  // a known issue atm.
  await Promise.all(
    platforms.map(
      (p) => $`docker buildx build \
  ${initialAction} \
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

  // If not testing and we pushed in the prior command, return
  if (pushOnly) {
    return;
  }

  // Test the image prior to pushing it
  if (shouldTest) {
    const testPlatform = requestedPlatform ?? 'linux/amd64';
    await $`docker run --platform ${testPlatform} --ipc=host -e CI=true --entrypoint ./test.sh browserless/chrome:${patchBranch}`;
  }

  if (shouldPush) {
    await Promise.all([
      $`docker push browserless/chrome:${patchBranch}`,
      $`docker push browserless/chrome:${minorBranch}`,
      $`docker push browserless/chrome:${majorBranch}`,
    ]);
  }
};

(async function deploy() {
  // Wait 30 seconds before proceeding to allow folks to verify.
  const answer = await prompt('\nProceed (y/n)?');

  if (answer !== 'y' || answer !== 'yes') {
    return;
  }

  if (buildBase) {
    const basePlatform = requestedPlatform ?? 'linux/amd64,linux/arm64';
    const buildAction = requestedActions.includes('push') ? '--push' : '--load';
    await $`docker buildx build ${buildAction} --platform ${basePlatform} -t browserless/base:${version} base`;
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
