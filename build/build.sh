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
refs=$(grep -Eo '(href|src)="[a-z]+\.(css|js)[^"]*"' app/index.html || true)
stale=$(grep -v "?v=$VER\"" <<<"$refs" || true)
[[ -z $stale ]] || { echo "app/index.html: update ?v= to $VER on: $stale" >&2; exit 1; }
# iOS 12 (iPhone 6) can't read the app's newer syntax (?. ?? ||= …): write an older-style copy to app/legacy/, which
# index.html loads on such phones. Commit it: the installer only downloads the repository.
rm -rf app/legacy; mkdir -p app/legacy
ESB=(npx --yes esbuild@0.24.0)
for f in app.js discover.js extras.js collection.js shopping.js timemachine.js moments.js; do
  "${ESB[@]}" "app/$f" --target=safari12 --log-level=warning --legal-comments=inline --outfile="app/legacy/$f"
done
"${ESB[@]}" app/app.css --target=safari12 --log-level=warning --outfile=app/legacy/app.css
python3 build/legacy.py app/legacy/app.css
for f in app/legacy/*.js app/legacy-polyfills.js app/sw.js; do
  npx --yes acorn@8.14.0 --ecma2019 --silent "$f" || { echo "$f still has syntax iOS 12 can't read" >&2; exit 1; }
done
grep -q 'cqw\|clamp(\|aspect-ratio: 1;$' app/legacy/app.css && grep -n 'cqw\|clamp(' app/legacy/app.css | head -3 | sed 's/^/note (legacy css, has a stand-in): /' >&2 || true
grep -q "var MARE_V = '$VER'" app/index.html || { echo "app/index.html: set MARE_V to '$VER' in the loader" >&2; exit 1; }
sed "s/__VERSION__/$VER/" build/mare.sh.in > mare.sh
chmod +x mare.sh
bash -n mare.sh
echo "Built mare.sh v$VER ($(wc -c < mare.sh) bytes)"
