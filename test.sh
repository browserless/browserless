#!/bin/bash
set -e

Xvfb :1 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

export DISPLAY=:1

./node_modules/.bin/jest --runInBand --bail --forceExit $@ && kill -TERM $xvfb
