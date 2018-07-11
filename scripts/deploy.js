#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const exec = util.promisify(child.exec);

const { releaseBranches } = require('../package.json');

const versionRegex = /\bv?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?\b/g;

const DEFAULT_PUPPETEER_VERSION = '1.4.0';
const DEPLOY_BRANCH = 'master';
const metaFiles = [
  'package.json',
  'package-lock.json',
  'version.json',
  'protocol.json',
  'hints.json'
];

const logExec = (cmd) => {
  console.log(`Executing "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length) {
      throw new Error(stderr);
    }
    return stdout.trim();
  });
};

const deployPuppeteerVersion = async (branch) => {
  const hasVersion = branch.match(versionRegex);
  const version = hasVersion ? hasVersion[0] : DEFAULT_PUPPETEER_VERSION;

  console.log(`>>> Deploying release ${branch} of browserless, puppeteer@${version}`);

  await logExec(`git checkout ${branch} --quiet`);
  await logExec(`git merge ${DEPLOY_BRANCH} --strategy-option theirs --commit --quiet`);
  await logExec(`rm -rf node_modules package-lock.json`);
  await logExec(`npm install --silent`);
  await logExec(`npm install --silent --save --save-exact puppeteer@${version}`);
  await logExec(`npm run meta --silent ${version.includes('chrome-stable') ? '-- --chrome-stable' : ''}`);

  for (let file of metaFiles) {
    try {
      await logExec(`git status --porcelain | grep ${file}`);
      console.log(`>>> Changes found in Puppeteer@${version}, comitting file ${file}`);
      await logExec(`git add ${file}`);
      await logExec(`git commit --quiet -m "DEPLOY.JS: Updating ${file} browser meta output" ${file}`);
    } catch (err) {
      console.log(`>>> No meta changes found, proceeding to next version.`);
    }
  }

  await logExec(`git push origin ${version} --quiet --no-verify`);
}

async function deploy () {
  const branch = await logExec('git rev-parse --abbrev-ref HEAD');
  if (branch.trim() !== DEPLOY_BRANCH) {
    console.error(`Not on ${DEPLOY_BRANCH} branch, exiting`);
    process.exit(1);
  }

  const status = await logExec('git status --porcelain');
  if (status.length) {
    console.error('Untracked files in git, please commit before deploying.');
    process.exit(1);
  }

  console.log(`>>> On branch ${DEPLOY_BRANCH} and no untracked files in git, proceeding...`);

  releaseBranches.reduce((lastJob, puppeteerVersion) => 
    lastJob.then(() => deployPuppeteerVersion(puppeteerVersion)), Promise.resolve());
}

deploy();
