#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);
const { map } = require('lodash');
const path = require('path');
const fs = require('fs-extra');

const {
  releaseVersions,
  puppeteerVersions,
  version,
} = require('../package.json');

const REPO = 'browserless/chrome';

const logExec = (cmd) => {
  debug(`  "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length > 0) {
      throw new Error(stderr.slice(-500));
    }
    return stdout.trim();
  });
};

async function cleanup () {
  return logExec(`git reset origin/master --hard`);
}

// version is the full tag (1.2.3-puppeteer-1.11.1)
// chrome version is one of the versions in packageJson.releaseVersions
const deployVersion = async (tags, chromeVersion) => {
  // Meta-data about the install, found in our package.json
  const versionInfo = puppeteerVersions[chromeVersion];
  const puppeteerVersion = versionInfo.puppeteer;
  const puppeteerChromiumRevision = versionInfo.chromeRevision;

  const [ patchBranch, minorBranch, majorBranch ] = tags;
  const isChromeStable = majorBranch.includes('chrome-stable');

  debug(`Beginning docker build and publish of tag ${patchBranch} ${minorBranch} ${majorBranch}`);

  await logExec(`npm install --silent --save --save-exact puppeteer@${puppeteerVersion}`);
  await logExec(`${isChromeStable ? 'USE_CHROME_STABLE=true CHROMEDRIVER_SKIP_DOWNLOAD=false ' : ''}npm run post-install`);

  const versionJson = fs.readJSONSync(path.join(__dirname, '..', 'version.json'));
  const chromeStableArg = isChromeStable ? 'true' : 'false';

  // docker build
  await logExec(`docker build \
  --quiet \
  --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
  --label "browser=${versionJson.Browser}" \
  --label "protocolVersion=${versionJson['Protocol-Version']}" \
  --label "v8Version=${versionJson['V8-Version']}" \
  --label "webkitVersion=${versionJson['WebKit-Version']}" \
  --label "debuggerVersion=${versionJson['Debugger-Version']}" \
  --label "puppeteerVersion=${versionJson['Puppeteer-Version']}" \
  -t ${REPO}:${patchBranch} \
  -t ${REPO}:${minorBranch} \
  -t ${REPO}:${majorBranch} .`);

  // docker push
  await Promise.all([
    logExec(`docker push ${REPO}:${patchBranch}`),
    logExec(`docker push ${REPO}:${minorBranch}`),
    logExec(`docker push ${REPO}:${majorBranch}`),
  ]);

  // git reset for next update
  await cleanup();
}

async function deploy () {
  const versions = map(releaseVersions, (chromeVersion) => {
    const [ major, minor, patch ] = version.split('.');

    const patchBranch = `${major}.${minor}.${patch}-${chromeVersion}`;
    const minorBranch = `${major}.${minor}-${chromeVersion}`;
    const majorBranch = `${major}-${chromeVersion}`;

    return {
      tags: [ patchBranch, minorBranch, majorBranch ],
      chromeVersion,
    };
  });

  await versions.reduce(
    (lastJob, { tags, chromeVersion }) =>
      lastJob
        .then(() => deployVersion(tags, chromeVersion))
        .catch((error) => {
          console.log(`Error in build (${version}): `, error);
          process.exit(1);
        }),
    Promise.resolve()
  );

  await logExec(`docker images -a | grep "${REPO}" | awk '{print $3}' | xargs docker rmi`);
  debug(`Complete! Cleaning up file-system and exiting.`);
}

deploy();
