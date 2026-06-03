#!/usr/bin/env bash
#
# Post an npm-publish notification to the Slack webhook. Called from
# .github/workflows/npm-publish.yml after a successful publish.
#
# Required env vars (the workflow injects these):
#   TAG                  — the git tag that triggered the publish (e.g. v2.51.0)
#   RELEASE_URL          — GitHub Releases URL for that tag
#   SLACK_WEBHOOK_URL    — the Slack incoming webhook (treat as secret)
#
# Uses jq to build the payload so message content with shell-metacharacters
# can't break the JSON structure.
set -euo pipefail

: "${TAG:?TAG must be set}"
: "${RELEASE_URL:?RELEASE_URL must be set}"
: "${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL must be set}"

payload=$(jq -n \
  --arg release_url "$RELEASE_URL" \
  --arg tag "$TAG" \
  '{text: ":package: *<\($release_url)|\($tag)>* of @browserless.io/browserless published to npm."}')

curl --fail-with-body \
  --request POST \
  --url "$SLACK_WEBHOOK_URL" \
  --header 'Content-Type: application/json' \
  --data "$payload"
