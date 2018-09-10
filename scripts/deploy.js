#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);

const {
  releaseBranches,
  puppeteerVersions,
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

const deployPuppeteerVersion = async (branch) => {
  const version = puppeteerVersions[branch];

  debug(`${branch}: Deploying release of browserless, puppeteer@${version}`);

  const currentBranch = await logExec('git rev-parse --abbrev-ref HEAD');

  if (currentBranch !== DEPLOY_BRANCH) {
    await checkoutReleaseBranch;
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
  await logExec(`git push origin ${branch} --quiet --no-verify &> /dev/null`);
}

async function cleanLocalBranches() {
  return Promise.all(
    releaseBranches.map((branch) =>
      exec(`git branch -D ${branch}`)
        .catch(() => {})
    )
  );
}

async function cleanRemoteBranches() {
  return Promise.all(
    releaseBranches.map((branch) =>
      exec(`git push origin --delete ${branch} --quiet --no-verify`)
        .catch(() => {})
    )
  );
}

async function cleanReleaseBranches() {
  return Promise.all([
    cleanLocalBranches(),
    cleanRemoteBranches(),
  ]);
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

  debug(`On branch ${DEPLOY_BRANCH} and no un-tracked files in git, proceeding to build deployment.`);
  debug(`Cleaning out local and remote deployment branches`);

  await cleanReleaseBranches();

  debug(`Starting release`);

  await releaseBranches.reduce((lastJob, puppeteerVersion) =>
    lastJob.then(() => deployPuppeteerVersion(puppeteerVersion)), Promise.resolve());

  debug(`Checking out master and removing release branches.`);

  await checkoutReleaseBranch();
}

deploy();
