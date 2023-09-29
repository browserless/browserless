#!/usr/bin/env bash

VERSION="${VERSION:-latest}"

docker buildx build \
  --push \
  --platform linux/amd64 \
  -t ghcr.io/browserless/chromium:$VERSION \
  -f ./docker/chromium/Dockerfile .
