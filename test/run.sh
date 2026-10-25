#!/usr/bin/env bash
# Runs the browser tests against the mock Navidrome + ListenBrainz server.
# Needs: python3, Pillow, Playwright with Chromium (pip install playwright pillow && playwright install chromium).
# Usage: test/run.sh            -> all suites, screenshots in test-output/
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-test-output}; mkdir -p "$OUT"
python3 test/mock_server.py app > "$OUT/mock.log" 2>&1 &
MOCK=$!; trap 'kill $MOCK 2>/dev/null' EXIT
sleep 1.5
for t in test_core test_discovery test_round3 test_round4 test_round5 test_round6 test_round7 test_round8 test_mobile; do
  echo "== $t"; python3 "test/$t.py" "$OUT"
done
