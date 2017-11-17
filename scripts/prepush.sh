#!/usr/bin/env bash

# This script ensures that the version.json and protocol.json
# files are in sync with the version of Chrome installed locally.
# There's likely a better way to do this, but this works for the time being.

npm install

./scripts/get-meta.js

if [[ `git status --porcelain | grep version.json` ]]; then
  echo "version.json file changes, committing..."
  git add version.json
  git commit -m "Updating version.json browser output"
else
  echo "No version.json file changes, proceeding"
fi

if [[ `git status --porcelain | grep protocol.json` ]]; then
  echo "protocol.json file changes, committing..."
  git add protocol.json
  git commit -m "Updating protocol.json browser output"
else
  echo "No protocol.json file changes, proceeding"
fi
