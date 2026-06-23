#!/bin/bash
set -e

# When docker restarts, this file is still there,
# so we need to kill it just in case
[ -f /tmp/.X99-lock ] && rm -f /tmp/.X99-lock

if [ -z "$DISPLAY" ]
then
  Xvfb :99 -screen 0 1024x768x16 -nolisten tcp -nolisten unix >/dev/null 2>&1 &
  xvfb=$!
  export DISPLAY=:99
fi

dumb-init -- node build/index.js "$@" &
node=$!

# Forward SIGTERM/SIGINT to node so its JS handlers can run.
_forward_term() { kill -TERM "$node" 2>/dev/null || true; }
trap _forward_term SIGTERM SIGINT

# Loop on wait until node actually exits. The first `wait` returns >128 the
# moment the signal arrives, leaving node still alive and mid-cleanup; with
# `set -e` and a single `wait`, bash would exit here and the kernel would
# SIGKILL node before BrowserManager.shutdown() finishes deleting
# /tmp/browserless-data-dirs/*. Looping until `kill -0` reports the PID is
# gone preserves the SDK's graceful-shutdown contract.
set +e
while kill -0 "$node" 2>/dev/null; do
  wait "$node"
  rc=$?
done
set -e

if [ -n "$xvfb" ]
then
  kill -TERM "$xvfb" 2>/dev/null || true
  wait "$xvfb" 2>/dev/null || true
fi

exit "${rc:-0}"
