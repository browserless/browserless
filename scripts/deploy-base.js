#!/usr/bin/env node
const child = require('child_process');
const util = require('util');
const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);

const BASE = 'browserless/base';
const VERSION = process.env.VERSION;

if (!VERSION) {
  throw new Error(`Expected a ${VERSION}, but none was found.`);
}

const logExec = (cmd) => {
  debug(`  "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length > 0) {
      throw new Error(stderr.slice(-500));
    }
    return stdout.trim();
  });
};

const buildBase = async () => {
  await logExec(`docker build -t ${BASE}:latest -t ${BASE}:${VERSION} ./base`);
  await logExec(`docker push ${BASE}:latest`);
  await logExec(`docker push ${VERSION}:latest`);
}

async function deploy () {
  // Build a fresh base image first, then subsequent
  // docker builds are super fast.
  await buildBase();

  await logExec(`docker images -a | grep "${BASE}" | awk '{print $3}' | xargs docker rmi`);
  debug(`Complete! Cleaning up file-system and exiting.`);
}

deploy();
