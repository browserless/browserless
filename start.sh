#!/bin/bash
set -e

_kill_procs() {
  kill -TERM $node
  wait $node
  kill -TERM $xvfb
}

# Relay quit commands to processes
trap _kill_procs SIGTERM SIGINT

Xvfb :99 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

export DISPLAY=:99

dumb-init -- node ./build/index.js $@ &
node=$!

wait $node
wait $xvfb
