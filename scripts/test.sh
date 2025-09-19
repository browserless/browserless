#!/bin/bash
set -e

# Install all dependencies for tests
npm clean-install

# Setup Env Variables
export DEBUG=-*
export PUPPETEER_DISABLE_HEADLESS_WARNING=true
export NODE_OPTIONS="--loader ts-node/esm"

if [ -z "$DISPLAY" ]
then
  Xvfb :99 -screen 0 1024x768x16 -nolisten tcp -nolisten unix >/dev/null 2>&1 &
  xvfb=$!
  export DISPLAY=:99
fi

# Run the tests
./node_modules/.bin/_mocha --timeout 45000 --slow 10000 --exit $@ && kill -TERM $xvfb
