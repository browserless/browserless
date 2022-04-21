#!/usr/bin/env node
/* eslint-disable no-undef */
const child = require('child_process');
const util = require('util');

const debug = require('debug')('browserless-docker-deploy');
const exec = util.promisify(child.exec);

const BASE = 'browserless/base';
const TARGET_ARCH = ['linux/amd64', 'linux/arm64/v8'];
const VERSION = process.env.VERSION;

if (!VERSION) {
  throw new Error(
    `Expected a $VERSION env variable to tag the ${BASE} repo, but none was found.`,
  );
}

const logExec = (cmd) => {
  debug(`  "${cmd}"`);
  return exec(cmd).then(({ stdout, stderr }) => {
    if (stderr.trim().length > 0) {
      console.warn(stderr.slice(-500));
    }
    return stdout.trim();
  });
};

const buildBase = async () => {
  await logExec(
    `docker buildx build --push --platform ${TARGET_ARCH.join(
      ',',
    )} -t ${BASE}:latest -t ${BASE}:${VERSION} ./base`,
  );
};

(async function deploy() {
  // Build a fresh base image first, then subsequent
  // docker builds are super fast.
  await buildBase();

  debug(`Complete! Cleaning up file-system and exiting.`);
})();
