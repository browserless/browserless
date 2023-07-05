#!/usr/bin/env bash

VERSION="${VERSION:-latest}"

docker buildx build \
  --push \
  --platform linux/amd64 \
  -t registry.browserless.io/foundation:$VERSION \
  -f ./docker/foundation/Dockerfile .
