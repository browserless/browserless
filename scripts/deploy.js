#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);
const {
  flatMap,
  noop
} = require('lodash');

const {
  chromeVersions,
  puppeteerVersions,
  version,
} = require('../package.json');

const DEPLOY_BRANCH = 'master';
const metaFiles = [
  'package.json',
  'package-lock.json',
  'version.json',
  'protocol.json',
  'hints.json'
];

const logExec = (cmd) => {
  debug(`  "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length) {
      throw new Error(stderr);
    }
    return stdout.trim();
  });
};

async function checkoutReleaseBranch () {
  return logExec(`git checkout ${DEPLOY_BRANCH} --quiet`);
}

const deployVersion = async (branch, chromeVersion) => {
  const version = puppeteerVersions[chromeVersion];

  debug(`${branch}: Deploying release of browserless, puppeteer@${version}`);

  const currentBranch = await logExec('git rev-parse --abbrev-ref HEAD');

  if (currentBranch !== DEPLOY_BRANCH) {
    await checkoutReleaseBranch();
  }

  await logExec(`git checkout -b ${branch} --quiet`);
  await logExec(`npm install --silent --save --save-exact puppeteer@${version}`);
  await logExec(`npm run meta --silent ${version.includes('chrome-stable') ? '-- --chrome-stable' : ''}`);

  for (let file of metaFiles) {
    try {
      await logExec(`git status --porcelain | grep ${file}`);
      debug(`${branch}: Changes found in Puppeteer@${version}, committing file ${file}`);
      await logExec(`git add ${file}`);
      await logExec(`git commit --quiet -m "DEPLOY.JS: Updating ${file} browser meta output" ${file}`);
    } catch (err) {
      debug(`${branch}: No meta changes found, proceeding to next version.`);
    }
  }

  // Have to do `&> /dev/null` to avoid remote messages
  await logExec(`git push origin ${branch} --force --quiet --no-verify &> /dev/null`);
}

async function deleteBranches(branches) {
  return Promise.all(
    branches.map((branch) => {
      console.log(`Deleting branch ${branch}`);
      return exec(`git branch -D ${branch}`).catch(noop);
    })
  );
}

async function deploy () {
  const branch = await logExec('git rev-parse --abbrev-ref HEAD');

  if (branch.trim() !== DEPLOY_BRANCH) {
    console.error(`Not on deploy branch "${DEPLOY_BRANCH}" branch, exiting`);
    process.exit(1);
  }

  const status = await logExec('git status --porcelain');

  if (status.length) {
    console.error('Un-tracked files in git, please commit before deploying.');
    process.exit(1);
  }

  const preCheckBranch = `${version}-chrome-stable`;
  const versionExists = await logExec(`git ls-remote --heads https://github.com/joelgriffith/browserless.git ${preCheckBranch}`);

  if (versionExists.trim().length) {
    console.log(`Version ${version} already exists on GitHub. Did you forget to 'npm bump'?`);
    process.exit(1);
  }

  debug(`On branch ${DEPLOY_BRANCH} and no un-tracked files in git, proceeding to build deployment.`);

  const branches = flatMap(chromeVersions, (chromeVersion) => {
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

  await deleteBranches(branches.map(([ branch ]) => branch));

  await branches.reduce((lastJob, [branch, chromeVersion]) =>
    lastJob.then(() => deployVersion(branch, chromeVersion)), Promise.resolve());

  debug(`Checking out master and removing release branches.`);

  await checkoutReleaseBranch();
}

deploy();
