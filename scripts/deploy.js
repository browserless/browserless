#!/usr/bin/env zx

/* eslint-disable no-undef */
const fs = require('fs/promises');

const getPort = require('get-port');
const { map, noop } = require('lodash');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');
const argv = require('yargs').argv;

const { releaseVersions, chromeVersions, version } = require('../package.json');

const REPO = 'browserless/chrome';
const BASE_VERSION = argv.base;

if (!BASE_VERSION) {
  throw new Error(
    `Expected a --base switch to tag the ${REPO} repo with, but none was found, eg: "npm run deploy -- --base 1.19.0".`,
  );
}

const requestedVersions = argv.versions
  ? argv.versions.split(',')
  : releaseVersions;
const action = argv.action ? argv.action : 'push';
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

if (!['push', 'load'].includes(action)) {
  throw new Error(`--actions must be one of push or load`);
}

console.log(
  `Building versions: ${requestedVersions.join(
    ', ',
  )} and ${action}ing into docker`,
);

async function cleanup() {
  await $`rm -rf browser.json`;
  await $`rm -rf node_modules`;
  await $`git clean -fd`;
  await $`git reset master --hard`;
}

const deployVersion = async (tags, pptrVersion) => {
  const versionInfo = chromeVersions[pptrVersion];

  if (!versionInfo) {
    throw new Error(
      `Couldn't locate version info for puppeteer version ${pptrVersion}. Did you forget to add it to the package.json?`,
    );
  }

  const puppeteerVersion = versionInfo.puppeteer;
  const puppeteerChromiumRevision = versionInfo.chromeRevision;
  const platform = versionInfo.platform || 'linux/amd64';

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

  const executablePath = puppeteer
    .createBrowserFetcher({ product: 'chrome' })
    .revisionInfo(puppeteerChromiumRevision).executablePath;

  await $`npm install --silent --save --save-exact puppeteer@${puppeteerVersion}`;
  await $`npm run postinstall`;

  const port = await getPort();
  const browser = await puppeteer.launch({
    executablePath: isChromeStable ? '/usr/bin/google-chrome' : executablePath,
    args: [`--remote-debugging-port=${port}`, '--no-sandbox'],
  });

  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const versionJson = await res.json();
  const debuggerVersion = versionJson['WebKit-Version'].match(
    /\s\(@(\b[0-9a-f]{5,40}\b)/,
  )[1];

  await Promise.all([
    fs.writeFile(
      'browser.json',
      JSON.stringify({
        ...versionJson,
        puppeteerVersion,
        debuggerVersion,
      }),
    ),
    browser.close(),
  ]);

  const chromeStableArg = isChromeStable ? 'true' : 'false';

  // docker build
  await $`docker buildx build \
  --${action} \
  --platform ${platform} \
  --build-arg "BASE_VERSION=${BASE_VERSION}" \
  --build-arg "PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}" \
  --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
  --build-arg "PUPPETEER_VERSION=${puppeteerVersion}" \
  --label "browser=${versionJson.Browser}" \
  --label "protocolVersion=${versionJson['Protocol-Version']}" \
  --label "v8Version=${versionJson['V8-Version']}" \
  --label "webkitVersion=${versionJson['WebKit-Version']}" \
  --label "debuggerVersion=${debuggerVersion}" \
  --label "puppeteerVersion=${puppeteerVersion}" \
  -t ${REPO}:${patchBranch} \
  -t ${REPO}:${minorBranch} \
  -t ${REPO}:${majorBranch} .`;

  await $`git add --force hosts.json browser.json`.catch(noop);
  await $`git commit --quiet -m "DEPLOY.js committing files for tag ${patchBranch}"`.catch(
    noop,
  );
  await $`git tag --force ${patchBranch}`;
  await $`git push origin ${patchBranch} --force --quiet --no-verify &> /dev/null`.catch(
    noop,
  );

  // git reset for next update
  await cleanup();
};

(async function deploy() {
  const buildVersions = map(requestedVersions, (pptrVersion) => {
    const [major, minor, patch] = version.split('.');

    const patchBranch = `${major}.${minor}.${patch}-${pptrVersion}`;
    const minorBranch = `${major}.${minor}-${pptrVersion}`;
    const majorBranch = `${major}-${pptrVersion}`;

    return {
      tags: [patchBranch, minorBranch, majorBranch],
      pptrVersion,
      arch: pptrVersion,
    };
  });

  await buildVersions.reduce(
    (lastJob, { tags, pptrVersion }) =>
      lastJob
        .then(() => deployVersion(tags, pptrVersion))
        .catch((error) => {
          console.log(`Error in build (${version}): `, error);
          process.exit(1);
        }),
    Promise.resolve(),
  );
})();
