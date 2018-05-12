#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const exec = util.promisify(child.exec);

const getMeta = require('./get-meta');
const { puppeteerVersions } = require('../package.json');

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
    return stdout;
  });
};

const deployPuppeteerVersion = async (version) => {
  console.log(`>>> Deploying ${version} of puppeteer`);
  await logExec(`git checkout puppeteer-${version} --quiet`);
  await logExec(`git merge ${DEPLOY_BRANCH} --commit --quiet`);
  await logExec(`npm install --save puppeteer@${version} --silent`);
  await getMeta();

  return Promise.all(metaFiles.map(async (file) => {
    const hasChanges = await logExec(`git status --porcelain | grep ${file}`);

    if (hasChanges.length) {
      console.log(`>>> Changes found in Puppeteer@${version}, comitting file ${file}`);
      await logExec(`git add ${file}`);
      await logExec(`git commit -m --quiet "DEPLOY.JS: Updating ${file} browser meta output"`);
    }

    console.log(`>>> No meta changes found, proceeding to next version.`);
  }));
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

  puppeteerVersions.reduce((lastJob, puppeteerVersion) => 
    lastJob.then(() => deployPuppeteerVersion(puppeteerVersion)), Promise.resolve());
}

deploy();
