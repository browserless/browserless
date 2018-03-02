#!/usr/bin/env bash

# This script ensures that the version.json and protocol.json
# files are in sync with the version of Chrome installed locally.
# There's likely a better way to do this, but this works for the time being.

npm install

./scripts/get-meta.js

for i in 'version' 'protocol' 'hints'
do
  if [[ `git status --porcelain | grep $i.json` ]]; then
    echo "$i.json file changes, committing..."
    git add $i.json
    git commit -m "Updating $i.json browser output"
  else
    echo "No $i.json file changes, proceeding"
  fi
done
