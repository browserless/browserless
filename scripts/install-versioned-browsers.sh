#!/bin/bash
set -euo pipefail

# install-versioned-browsers.sh <browser> [browser...]
# Installs browser binaries (with system dependencies) for each versioned
# Playwright package. This ensures protocol compatibility when older Playwright
# clients connect — each version gets its own matching binary.
#
# Usage:
#   ./scripts/install-versioned-browsers.sh webkit
#   ./scripts/install-versioned-browsers.sh webkit firefox chromium

if [ $# -eq 0 ]; then
  echo "Usage: $0 <browser> [browser...]"
  exit 1
fi

BROWSERS="$*"

echo "Installing browsers ($BROWSERS) for versioned Playwright packages..."

for pkg_dir in node_modules/playwright-1.*/; do
  pkg_name=$(basename "$pkg_dir")
  cli="${pkg_dir}cli.js"

  if [ ! -f "$cli" ]; then
    continue
  fi

  echo "  Installing $BROWSERS for $pkg_name..."
  # shellcheck disable=SC2086
  node "$cli" install --with-deps $BROWSERS || echo "  Warning: Failed to install $BROWSERS for $pkg_name"
done

echo "  Installing $BROWSERS for playwright-core..."
# shellcheck disable=SC2086
node node_modules/playwright-core/cli.js install --with-deps $BROWSERS

echo "Done."
