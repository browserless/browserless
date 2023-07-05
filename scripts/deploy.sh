#!/usr/bin/env bash

VERSION="${VERSION:-latest}"

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t registry.browserless.io/foundation:$VERSION \
  -f ./docker/foundation/Dockerfile . && \

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t registry.browserless.io/chromium:$VERSION \
  -f ./docker/chromium/Dockerfile . && \

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t registry.browserless.io/basic:$VERSION \
  -f ./docker/basic/Dockerfile .
