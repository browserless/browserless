#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);
const { flatMap } = require('lodash');

const {
  chromeVersions,
  puppeteerVersions,
  version,
} = require('../package.json');

const REPO = 'browserless/chrome';

const logExec = (cmd) => {
  debug(`  "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length) {
      throw new Error(stderr);
    }
    return stdout.trim();
  });
};

async function cleanup () {
  return logExec(`git reset HEAD --hard`);
}

// version is the full tag (1.2.3-puppeteer-1.11.1)
// chrome version is one of the versions in packageJson.chromeVersions
const deployVersion = async (tagVersion, chromeVersion) => {
  const puppeteerVersion = puppeteerVersions[chromeVersion];

  debug(`${tagVersion}: Beginning docker build and publish`);

  await logExec(`npm install --silent --save --save-exact puppeteer@${puppeteerVersion}`);
  await logExec(`npm run meta --silent ${tagVersion.includes('chrome-stable') ? '-- --chrome-stable' : ''}`);

  const versionJson = require('../version.json');
  const chromeStableArg = tagVersion.includes('chrome-stable') ? 'true' : 'false';

  // docker build
  await logExec(`docker build \
  --build-arg "USE_CHROME_STABLE=${chromeStableArg}" \
  --label "browser=${versionJson.Browser}" \
  --label "protocolVersion=${versionJson['Protocol-Version']}" \
  --label "v8Version=${versionJson['V8-Version']}" \
  --label "webkitVersion=${versionJson['WebKit-Version']}" \
  --label "debuggerVersion=${versionJson['Debugger-Version']}" \
  --label "puppeteerVersion=${versionJson['Puppeteer-Version']}" \
  -t ${REPO}:${tagVersion} .`);

  // docker push
  await logExec(`docker push ${REPO}:${tagVersion}`);

  // Commit the resulting package/meta file changes, tag and push
  await logExec(`git add ./*.json`);
  await logExec(`git commit --quiet -m "DEPLOY.js commitings JSON files for tag ${tagVersion}"`);
  await logExec(`git tag ${tagVersion}`);
  await logExec(`git push origin ${tagVersion} --force --quiet --no-verify &> /dev/null`);

  // git reset for next update
  await cleanup();
}

async function deploy () {
  const versions = flatMap(chromeVersions, (chromeVersion) => {
    const [ major, minor, patch ] = version.split('.');

    const patchBranch = `${major}.${minor}.${patch}-${chromeVersion}`;
    const minorBranch = `${major}.${minor}-${chromeVersion}`;
    const majorBranch = `${major}-${chromeVersion}`;

    return [
      [ patchBranch, chromeVersion ],
      [ minorBranch, chromeVersion ],
      [ majorBranch, chromeVersion ],
    ];
  });

  await versions.reduce(
    (lastJob, [version, chromeVersion]) =>
      lastJob
        .then(() => deployVersion(version, chromeVersion))
        .catch((error) => {
          console.log(`Error in build (${version}): `, error);
          process.exit(1);
        }),
    Promise.resolve()
  );

  await logExec(`docker system prune -af`);
  debug(`Complete! Cleaning up file-system and exiting.`);
}

deploy();
