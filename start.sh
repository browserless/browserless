#!/bin/bash
set -e

# Setup env variables
export DISPLAY=:99

# When docker restarts, this file is still there,
# so we need to kill it just in case
[ -f /tmp/.X99-lock ] && rm -f /tmp/.X99-lock

_kill_procs() {
  kill -TERM $node
  kill -TERM $xvfb
}

# Relay quit commands to processes
trap _kill_procs SIGTERM SIGINT

Xvfb :99 -screen 0 1920x1080x16 -nolisten tcp -nolisten unix &
xvfb=$!

dumb-init -- node ./build/index.js $@ &
node=$!

wait $node

if [ ! -z "$xvfb" ]
then
  wait $xvfb
fi
