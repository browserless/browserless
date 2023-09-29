#!/usr/bin/env bash

VERSION="${VERSION:-latest}"

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/browserless/foundation:$VERSION \
  -f ./docker/foundation/Dockerfile . && \

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/browserless/chromium:$VERSION \
  -f ./docker/chromium/Dockerfile . && \

docker buildx build \
  --push \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/browserless/basic:$VERSION \
  -f ./docker/basic/Dockerfile .
