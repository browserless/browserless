#!/usr/bin/env bash
#
# Install Google Chrome stable for the image's native architecture.
#
# playwright's own `install chrome` can't do this: its
# bin/reinstall_chrome_stable_linux.sh exits on aarch64 and hardcodes the amd64
# deb URL. Google now publishes google-chrome-stable for amd64 and arm64, so we
# fetch the deb ourselves and only use playwright for the shared libraries.
#
# 32-bit ARM can't be supported: there's no armhf Chrome package, and
# playwright-core only recognises x64 and arm64 on Linux.
#
set -euo pipefail

ARCH="$(dpkg --print-architecture)"

case "${ARCH}" in
amd64 | arm64) ;;
*)
  echo "ERROR: Google Chrome stable is not published for '${ARCH}'; supported architectures are amd64 and arm64." >&2
  exit 1
  ;;
esac

DEB_URL="https://dl.google.com/linux/direct/google-chrome-stable_current_${ARCH}.deb"
DEB_PATH="/tmp/google-chrome-stable_current_${ARCH}.deb"

./node_modules/playwright-core/cli.js install-deps chromium

# The base image clears /var/lib/apt/lists.
apt-get update

curl -fsSL -o "${DEB_PATH}" "${DEB_URL}"

# Installing the local deb lets apt resolve its Depends from the archive.
apt-get install -y "${DEB_PATH}"

rm -f "${DEB_PATH}"

google-chrome-stable --version
