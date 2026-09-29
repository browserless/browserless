#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$ROOT/scripts/install-versioned-browsers.sh" "$TMP/install.sh"
mkdir -p "$TMP/bin" "$TMP/node_modules/playwright-1.58" "$TMP/node_modules/playwright-1.59" \
  "$TMP/node_modules/playwright-1.60" \
  "$TMP/node_modules/playwright-1.61" "$TMP/node_modules/playwright-1.100" "$TMP/node_modules/playwright-core" \
  "$TMP/ms-playwright/ready"
touch "$TMP/node_modules/playwright-1.58/cli.js" "$TMP/node_modules/playwright-1.59/cli.js" \
  "$TMP/node_modules/playwright-1.60/cli.js" \
  "$TMP/node_modules/playwright-1.61/cli.js" \
  "$TMP/node_modules/playwright-1.100/cli.js" \
  "$TMP/node_modules/playwright-core/cli.js" \
  "$TMP/ms-playwright/ready/INSTALLATION_COMPLETE"

cat > "$TMP/bin/node" <<'EOF'
#!/bin/bash
echo "$*" >> "$CALLS"
if [[ "$*" == *" --dry-run" ]]; then
  printf 'Install location: %s/ms-playwright/ready\nhttps://example.test/browser.zip\n' "$PWD"
fi
EOF
chmod +x "$TMP/bin/node"

run_install() {
  : > "$TMP/calls"
  (cd "$TMP" && CALLS="$TMP/calls" PATH="$TMP/bin:$PATH" bash ./install.sh "$1")
}

run_install webkit
grep -q 'playwright-core/cli.js install-deps webkit' "$TMP/calls"
grep -q 'playwright-1.61/cli.js install webkit --dry-run' "$TMP/calls"
grep -q 'playwright-1.100/cli.js install webkit --dry-run' "$TMP/calls"
grep -q 'playwright-core/cli.js install webkit --dry-run' "$TMP/calls"
if grep -Eq 'playwright-1\.(58|59|60)/cli.js install webkit' "$TMP/calls"; then
  echo 'WebKit before Playwright 1.61 should be skipped' >&2
  exit 1
fi

for browser in chromium firefox; do
  run_install "$browser"
  grep -q "playwright-1.60/cli.js install $browser --dry-run" "$TMP/calls"
done

echo 'install-versioned-browsers tests passed'
