#!/usr/bin/env zx
/* eslint-disable no-undef */
const debug = require('debug')('browserless-docker-deploy');

const BASE = 'browserless/base';
const TARGET_ARCH = ['linux/amd64', 'linux/arm64/v8'];
const VERSION = process.env.VERSION;

if (!VERSION) {
  throw new Error(
    `Expected a $VERSION env variable to tag the ${BASE} repo, but none was found.`
  );
}

const buildBase = async () => {
  await $`docker buildx build --push --platform ${TARGET_ARCH.join(
    ','
  )} -t ${BASE}:latest -t ${BASE}:${VERSION} ./base`;
};

(async function deploy() {
  // Build a fresh base image first, then subsequent
  // docker builds are super fast.
  await buildBase();

  debug(`Complete! Cleaning up file-system and exiting.`);
})();
