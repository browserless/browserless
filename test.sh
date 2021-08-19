#!/bin/bash
set -e

Xvfb :1 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

export DISPLAY=:1

export SOME_ENV_VAR_TO_ALLOW_IN_FUNCTIONS=true

./node_modules/.bin/eslint src --ext .ts &&
./node_modules/.bin/jest --runInBand --forceExit $@ && kill -TERM $xvfb
