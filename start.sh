#!/bin/bash

_kill_procs() {
  kill -TERM $node
  wait $node
  kill -TERM $xvfb
}

# Relay quit commands to processes
trap _kill_procs SIGTERM SIGINT

Xvfb :1 -screen 0 1024x768x16 -nolisten tcp -nolisten unix &
xvfb=$!

export DISPLAY=:1

dumb-init -- node ./build/index.js $@ &
node=$!

wait $node
wait $xvfb
