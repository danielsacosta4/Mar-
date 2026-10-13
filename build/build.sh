#!/usr/bin/env bash
# Builds mare.sh at the repo root from the installer template. The installer downloads the app itself
# from GitHub, so this only stamps the version and checks the app's scripts.
# Usage: build/build.sh 1.5.0
set -euo pipefail
cd "$(dirname "$0")/.."
VER=${1:?usage: build/build.sh <version>}
for f in app/*.js; do node --check "$f"; done
grep -q "MARE_VERSION = '$VER'" app/app.js || { echo "app/app.js says a different version than $VER" >&2; exit 1; }
grep -q "VERSION = '$VER'" app/sw.js || { echo "app/sw.js says a different version than $VER" >&2; exit 1; }
# Every stylesheet and script in index.html carries ?v=<version>, so proxies and browsers can't serve last
# release's copy (NPMplus "Cache Assets" keeps .css/.js for days).
refs=$(grep -Eo '(href|src)="[a-z]+\.(css|js)[^"]*"' app/index.html)
stale=$(grep -v "?v=$VER\"" <<<"$refs" || true)
[[ -z $stale ]] || { echo "app/index.html: update ?v= to $VER on: $stale" >&2; exit 1; }
sed "s/__VERSION__/$VER/" build/mare.sh.in > mare.sh
chmod +x mare.sh
bash -n mare.sh
echo "Built mare.sh v$VER ($(wc -c < mare.sh) bytes)"
