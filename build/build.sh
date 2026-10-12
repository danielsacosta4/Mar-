#!/usr/bin/env bash
# Builds mare.sh at the repo root: installer template + the app (lightly minified, xz-compressed, base64).
# Usage: build/build.sh 1.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
VER=${1:?usage: build/build.sh <version>}
FILES=(index.html app.css app.js discover.js extras.js sw.js icon.svg icon-192.png icon-512.png manifest.webmanifest)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src"; (cd app && cp "${FILES[@]}" "$TMP/src/")
python3 build/minify.py "$TMP/src" "$TMP/min"
for f in "$TMP"/min/*.js; do node --check "$f"; done
sed "s/__VERSION__/$VER/" build/mare.sh.in > mare.sh
tar cf - --owner=0 --group=0 -C "$TMP/min" "${FILES[@]}" | xz -9e | base64 -w 76 >> mare.sh
chmod +x mare.sh
SIZE=$(wc -c < mare.sh)
echo "Built mare.sh v$VER ($SIZE bytes)"
# bash -c "$(curl …)" passes the script as one argument; Linux caps a single argument at 128 KiB.
if [ "$SIZE" -gt 120000 ]; then echo "WARNING: mare.sh is close to the 128 KiB one-liner limit" >&2; fi
