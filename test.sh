#!/bin/bash
set -e

# Install devDependencies for tests
npm i --production=false

# Setup env variables
export DISPLAY=:1
export DEBUG=-*
export PUPPETEER_DISABLE_HEADLESS_WARNING=true
export NODE_OPTIONS="--loader ts-node/esm"

Xvfb :1 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

# Run the tests
./node_modules/.bin/_mocha --timeout 30000 --slow 10000 --exit $@ && kill -TERM $xvfb
