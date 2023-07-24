#!/bin/bash
set -e

Xvfb :1 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

export DISPLAY=:1

export SOME_ENV_VAR_TO_ALLOW_IN_FUNCTIONS=true

DEBUG=-* PUPPETEER_DISABLE_HEADLESS_WARNING=true SOME_ENV_VAR_TO_ALLOW_IN_FUNCTIONS=bar ./node_modules/.bin/mocha --timeout 30000 --slow 10000 --exit $@ && kill -TERM $xvfb
