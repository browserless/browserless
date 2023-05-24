#!/usr/bin/env zx

/* eslint-disable no-undef */
const { map } = require('lodash');
const argv = require('yargs').argv;

const {
  releaseVersions,
  chromeVersions,
  version: npmVersion,
} = require('../package.json');

if (argv.h || argv.help) {
  return console.log(`---
'$ npm run deploy'

Builds a new browserless/base and browserless/chrome with a version defined in the package.json field and builds then pushes the image into docker.
This CLI is interactive and you can override many parts of this build process. Please follow the prompts which include sensible defaults.
---`);
}

(async function deploy() {
  const baseRepo =
    (await question(
      `Enter a custom base repo, or use default of "browserless/base"? `,
    )) || 'browserless/base';
  const repo =
    (await question(
      `Enter a custom repo, or use default of "browserless/chrome"? `,
    )) || 'browserless/chrome';
  const version =
    (await question(
      `Enter a semantic version (eg "1.5.3") or use default of "${npmVersion}"? `,
    )) || npmVersion;
  const buildBase = (
    (await question(`Build the the "${baseRepo}" image (yes/no)? `)) || 'no'
  ).includes('y');
  const platforms =
    (await question(
      `Which platforms do you want to build for (default is "linux/arm64,linux/amd64")? `,
    )) || 'linux/arm64,linux/amd64';
  const puppeteerVersions =
    (await question(
      `Which puppeteer versions do you want to make (Must be contained package.json "releaseVersions" and defaults to that list)? `,
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

  // LOG...
  const work = [
    buildBase ? `Building "${baseRepo}:${version}" on "${platforms}"` : null,
    `Building "${repo}:${version}" on "${platforms}" for versions ${requestedVersions.join(
      ', ',
    )}`,
  ];

  console.log(work.filter((_) => !!_).join('.\n'));

  const proceed = (await question('Proceed (y/n)?')).includes('y');

  if (!proceed) {
    return;
  }

  const deployVersion = async (tags, v) => {
    const versionInfo = chromeVersions[v];

    if (!versionInfo) {
      throw new Error(
        `Couldn't locate version info for puppeteer version "${v}". Did you forget to add it to the package.json?`,
      );
    }

    const puppeteerChromiumRevision = versionInfo.chromeRevision;
    const puppeteerVersion = versionInfo.puppeteer;

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
    --platform ${platforms} \
    --build-arg "BASE_VERSION=${version}" \
    --build-arg "BASE_REPO=${baseRepo}" \
    --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
    --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
    --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
    -t ${repo}:${patchBranch} \
    -t ${repo}:${minorBranch} \
    -t ${repo}:${majorBranch} .`;
  };

  if (buildBase) {
    await $`docker buildx build --push --platform ${platforms} -t ${baseRepo}:${version} base`;
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
