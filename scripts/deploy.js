#!/usr/bin/env zx

/* eslint-disable no-undef */
const getPort = require('get-port');
const { map, noop } = require('lodash');
const fetch = require('node-fetch');
const puppeteer = require('puppeteer');

const { releaseVersions, chromeVersions, version } = require('../package.json');

const REPO = 'browserless/chrome';
const BASE_VERSION = process.env.BASE_VERSION;

if (!BASE_VERSION) {
  throw new Error(
    `Expected a $BASE_VERSION env variable to tag the ${REPO} repo, but none was found.`
  );
}

async function cleanup() {
  await $`git reset origin/master --hard`;
  await $`rm -rf node_modules`;
}

const deployVersion = async (tags, pptrVersion) => {
  const versionInfo = chromeVersions[pptrVersion];

  if (!versionInfo) {
    throw new Error(
      `Couldn't locate version info for puppeteer version ${pptrVersion}. Did you forget to add it to the package.json?`
    );
  }

  const puppeteerVersion = versionInfo.puppeteer;
  const puppeteerChromiumRevision = versionInfo.chromeRevision;
  const platform = versionInfo.platform || 'linux/amd64';

  const [patchBranch, minorBranch, majorBranch] = tags;
  const isChromeStable = majorBranch.includes('chrome-stable');

  await $`PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}\
    ${
      isChromeStable
        ? 'USE_CHROME_STABLE=true CHROMEDRIVER_SKIP_DOWNLOAD=false PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true'
        : ''
    } \
    npm install --silent --save --save-exact puppeteer@${puppeteerVersion}
  `;

  await $`PUPPETEER_CHROMIUM_REVISION=${puppeteerChromiumRevision}\
    ${
      isChromeStable
        ? 'USE_CHROME_STABLE=true CHROMEDRIVER_SKIP_DOWNLOAD=false PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true'
        : ''
    } \
    npm run postinstall
  `;

  const port = await getPort();
  const browser = await puppeteer.launch({
    executablePath: isChromeStable
      ? '/usr/bin/google-chrome'
      : puppeteer
          .executablePath()
          .replace(/[0-9]{6,7}/g, puppeteerChromiumRevision),
    args: [`--remote-debugging-port=${port}`, '--no-sandbox'],
  });

  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  const versionJson = await res.json();
  const debuggerVersion = versionJson['WebKit-Version'].match(
    /\s\(@(\b[0-9a-f]{5,40}\b)/
  )[1];

  await browser.close();

  const chromeStableArg = isChromeStable ? 'true' : 'false';

  // docker build
  await $`docker buildx build \
  --push \
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

  await $`git add --force hosts.json`.catch(noop);
  await $`git commit --quiet -m "DEPLOY.js committing files for tag ${patchBranch}"`.catch(
    noop
  );
  await $`git tag --force ${patchBranch}`;
  await $`git push origin ${patchBranch} --force --quiet --no-verify &> /dev/null`.catch(
    noop
  );

  // git reset for next update
  await cleanup();
};

(async function deploy() {
  const versions = map(releaseVersions, (pptrVersion) => {
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

  await versions.reduce(
    (lastJob, { tags, pptrVersion }) =>
      lastJob
        .then(() => deployVersion(tags, pptrVersion))
        .catch((error) => {
          console.log(`Error in build (${version}): `, error);
          process.exit(1);
        }),
    Promise.resolve()
  );
})();
