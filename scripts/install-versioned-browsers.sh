#!/bin/bash
set -euo pipefail

# install-versioned-browsers.sh <browser> [browser...]
#
# Installs each pinned Playwright version's browser binaries so older clients get
# a matching browser. We fetch + unzip the archives ourselves instead of
# `playwright install` because playwright-core < 1.60.0 deadlocks during zip
# extraction on Node >= 24.16.0 (microsoft/playwright#40724, fixed in 1.60.0).
#
# TODO: drop this once the minimum bundled playwright-core is >= 1.60.0.

if [ $# -eq 0 ]; then
  echo "Usage: $0 <browser> [browser...]"
  exit 1
fi
BROWSERS=("$@")

CORE_CLI="node_modules/playwright-core/cli.js"

# Log a per-component error. set -e is suspended inside install_browser (it is
# called via `|| failed=1`), so callers still pair this with an explicit return.
fail() { echo "  ERROR: $*" >&2; }

# Parse `playwright install <browser> --dry-run` into one line per component:
#   <install-dir>\t<url1> <url2> ...
# A single browser can expand to several components (e.g. chromium pulls ffmpeg
# and chromium-headless-shell), each with its own dir and ordered mirror URLs.
# shellcheck disable=SC2016  # awk program: $0/RSTART are awk fields, not shell vars
AWK_PARSE='
  /Install location:/ {
    if (dir != "") print dir "\t" urls
    dir = $0; sub(/^.*Install location:[ \t]*/, "", dir); gsub(/\r/, "", dir); urls = ""
    next
  }
  {
    line = $0
    while (match(line, /https:\/\/[^ \t\r"]+\.zip/)) {
      u = substr(line, RSTART, RLENGTH)
      urls = (urls == "" ? u : urls " " u)
      line = substr(line, RSTART + RLENGTH)
    }
  }
  END { if (dir != "") print dir "\t" urls }
'

tmp_zip="$(mktemp -t pw-browser-XXXXXX.zip)"
trap 'rm -f "$tmp_zip"' EXIT

# Download + extract every component of <browser> for the given Playwright CLI.
# Returns non-zero (without aborting the whole script) on any failure so the
# caller can report which version failed.
install_browser() {
  local cli="$1" browser="$2" dry components dir urlstr fetched url validate rc
  local -a urls

  if ! dry="$(node "$cli" install "$browser" --dry-run 2>&1)"; then
    fail "dry-run failed for $browser via $cli:"; printf '    %s\n' "$dry" >&2
    return 1
  fi
  components="$(printf '%s\n' "$dry" | awk "$AWK_PARSE")"
  if [ -z "$components" ]; then
    fail "parsed no components from dry-run for $browser via $cli:"; printf '    %s\n' "$dry" >&2
    return 1
  fi

  while IFS=$'\t' read -r dir urlstr; do
    [ -n "$dir" ] || continue
    # Must be an absolute path inside a Playwright browsers cache; guards the
    # `rm -rf "$dir"` below against a misparsed/unexpected directory.
    case "$dir" in
      */playwright-browsers/* | */ms-playwright/*) ;;
      *) fail "refusing suspicious install dir '$dir'"; return 1 ;;
    esac
    if [ -e "$dir/INSTALLATION_COMPLETE" ]; then
      echo "  already present: $dir"
      continue
    fi
    read -ra urls <<< "$urlstr"
    [ "${#urls[@]}" -gt 0 ] || { fail "no download URL for $dir"; return 1; }

    echo "  Fetching $(basename "$dir")"
    fetched=0
    for url in "${urls[@]}"; do
      if curl -fsSL --retry 3 --retry-delay 2 -o "$tmp_zip" "$url"; then fetched=1; break; fi
      echo "    mirror failed, trying next: $url" >&2
    done
    [ "$fetched" -eq 1 ] || { fail "all mirrors failed for $dir"; return 1; }

    # Extract into a clean dir and only mark complete on a verified extraction,
    # so a partial/corrupt unzip is never cached as installed. (set -e is
    # suspended in this function, so every mutation is checked explicitly.)
    if ! { rm -rf "$dir" && mkdir -p "$dir"; }; then
      fail "could not prepare clean dir $dir"; return 1
    fi
    if ! unzip -q -o "$tmp_zip" -d "$dir"; then
      fail "unzip failed for $dir"; rm -rf "$dir"; return 1
    fi
    if [ -z "$(ls -A "$dir" 2>/dev/null)" ]; then
      fail "empty extraction for $dir"; rm -rf "$dir"; return 1
    fi
    if ! touch "$dir/INSTALLATION_COMPLETE"; then
      fail "could not write completion marker for $dir"; rm -rf "$dir"; return 1
    fi
  done <<< "$components"

  # Let Playwright validate its own view: with every marker present this exits
  # immediately without re-extracting. A missing component would make it
  # re-extract (and deadlock on the broken versions), so bound it with a timeout
  # (-k force-kills a process still stuck after SIGTERM); exit 124 == timed out.
  rc=0
  validate="$(timeout -k 10 120 node "$cli" install "$browser" 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then
      fail "validation timed out for $browser via $cli (missing component -> re-extraction deadlock?)"
    else
      fail "Playwright could not validate $browser via $cli (exit $rc):"
    fi
    printf '    %s\n' "$validate" >&2
    return 1
  fi
}

# System dependencies, once. `install-deps` never extracts a browser archive, so
# it is immune to the yauzl bug, so run it via the core CLI regardless of version.
echo "Installing system dependencies for ${BROWSERS[*]}..."
if ! node "$CORE_CLI" install-deps "${BROWSERS[@]}"; then
  echo "ERROR: failed to install system dependencies for ${BROWSERS[*]}" >&2
  exit 1
fi

# Every Playwright CLI to satisfy: the versioned aliases + playwright-core.
clis=()
for pkg_dir in node_modules/playwright-1.*/; do
  [ -f "${pkg_dir}cli.js" ] && clis+=("${pkg_dir}cli.js")
done
clis+=("$CORE_CLI")

failed=0
for cli in "${clis[@]}"; do
  for browser in "${BROWSERS[@]}"; do
    echo "Installing $browser for $cli..."
    install_browser "$cli" "$browser" || failed=1
  done
done

if [ "$failed" -ne 0 ]; then
  echo "ERROR: one or more versioned browser installs failed" >&2
  exit 1
fi
echo "Done."
