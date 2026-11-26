#!/usr/bin/env bash
# The container's self-update (mare-update + mare.sh --apply), exercised in a scratch folder: nothing outside it is
# touched. "GitHub" is a local web server; caddy and systemctl are stand-ins that only record what they were asked.
#   test/test_selfupdate.sh        (needs ./mare.sh built by build/build.sh)
set -uo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); R=$T/root; G=$T/github; BIN=$T/bin
trap 'kill $P1 $P2 2>/dev/null; rm -rf "$T"' EXIT
FAIL=0
check() { if eval "$2"; then echo "  ok      $1"; else echo "  PROBLEM $1"; FAIL=1; fi; }
state() { python3 -c "import json,sys;print(json.load(open('$R/var/www/mare/update.json'))['state'])" 2>/dev/null; }
conf() { ( . "$R/etc/mare.conf"; eval "printf %s \"\${$1:-}\"" ); }
appv() { grep -o "MARE_VERSION = '[^']*'" "$R/var/www/mare/app.js" | cut -d"'" -f2; }

# --- stand-ins
mkdir -p "$BIN" "$G/raw/app" "$R/etc/caddy" "$R/var/www/mare"
printf '#!/bin/bash\necho "caddy $*" >> %q\n[[ -f %q ]] && exit 1\nexit 0\n' "$T/calls.log" "$T/caddy-rejects" > "$BIN/caddy"
printf '#!/bin/bash\necho "systemctl $*" >> %q\nexit 0\n' "$T/calls.log" > "$BIN/systemctl"
chmod +x "$BIN"/*; export PATH="$BIN:$PATH"

# --- a release = this repository's app + mare.sh, at a given version number
release() {   # release VERSION -> $G/src.tgz and the version GitHub shows
  local d=$T/rel/Mar--main; rm -rf "$T/rel"; mkdir -p "$d"
  cp -a app mare.sh "$d/"
  sed -i "s/MARE_VERSION = '[^']*'/MARE_VERSION = '$1'/" "$d/app/app.js"
  sed -i "s/const VERSION = '[^']*'/const VERSION = '$1'/" "$d/app/sw.js"
  tar czf "$G/src.tgz" -C "$T/rel" Mar--main
  cp "$d/app/sw.js" "$G/raw/app/sw.js"
}
announce() { sed -i "s/const VERSION = '[^']*'/const VERSION = '$1'/" "$G/raw/app/sw.js"; }   # GitHub shows a version…

# --- the container before: an old Maré, no updater
printf "window.MARE_VERSION = '1.0.0';\n" > "$R/var/www/mare/app.js"
printf 'old caddyfile\n' > "$R/etc/caddy/Caddyfile"
printf 'NAVIDROME=http://127.0.0.1:4533\nMARE_VERSION=1.0.0\n' > "$R/etc/mare.conf"

python3 -m http.server 8791 --bind 127.0.0.1 --directory "$G" >/dev/null 2>&1 & P1=$!
( cd "$R/var/www" && exec python3 -c "
import http.server, functools, os
class H(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, p): return os.path.join('$R/var/www/mare', p.split('?')[0].lstrip('/'))
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', 8792), H).serve_forever()" ) & P2=$!
sleep 1
export MARE_ROOT=$R MARE_RAW=http://127.0.0.1:8791/raw MARE_SOURCE=http://127.0.0.1:8791/src.tgz
export MARE_HEALTH_URL=http://127.0.0.1:8792/app.js MARE_HEALTH_WAIT=0.2
UPD=$R/usr/local/bin/mare-update

echo "== first install of the updater (what the host command leaves behind): apply release 5.0.0"
release 5.0.0; mkdir -p "$T/un" && tar xzf "$G/src.tgz" -C "$T/un" --strip-components=1
bash "$T/un/mare.sh" --apply "$T/un" >/dev/null 2>&1
check "app is 5.0.0" '[[ $(appv) == 5.0.0 ]]'
check "settings kept, version recorded" '[[ $(conf MARE_VERSION) == 5.0.0 && $(conf NAVIDROME) == http://127.0.0.1:4533 ]]'
check "updater and timer installed, timer switched on" '[[ -x $UPD && -f $R/etc/systemd/system/mare-update.timer ]] && grep -q "enable -q --now mare-update.timer" "$T/calls.log"'
check "server configuration changed -> one restart" '[[ $(grep -c "systemctl restart caddy" "$T/calls.log") == 1 ]]'
check "status says updated" '[[ $(state) == updated ]]'

echo "== 1. already up to date"
before=$(find "$R/var/www/mare" -type f ! -name update.json | sort | xargs cat | md5sum)
bash "$UPD"
check "status says current" '[[ $(state) == current ]]'
check "nothing changed" '[[ $(find "$R/var/www/mare" -type f ! -name update.json | sort | xargs cat | md5sum) == "$before" ]]'

echo "== 2. a new release (5.0.1)"
release 5.0.1; bash "$UPD" >/dev/null 2>&1
check "app is 5.0.1" '[[ $(appv) == 5.0.1 && $(conf MARE_VERSION) == 5.0.1 ]]'
check "status says updated" '[[ $(state) == updated ]]'
check "no leftovers" '[[ ! -e $R/var/www/mare.old && ! -e $R/var/www/mare.new && ! -e $R/etc/caddy/Caddyfile.new ]]'
check "same server configuration -> no restart (music not cut)" '[[ $(grep -c "systemctl restart caddy" "$T/calls.log") == 1 ]]'

echo "== 3. a damaged download (GitHub shows 5.0.2, the file is rubbish)"
announce 5.0.2; head -c 2000 /dev/urandom > "$G/src.tgz"; bash "$UPD" >/dev/null 2>&1
check "still 5.0.1" '[[ $(appv) == 5.0.1 && $(conf MARE_VERSION) == 5.0.1 ]]'
check "status says offline (it tries again later)" '[[ $(state) == offline ]]'

echo "== 4. a release that doesn't open (5.0.3 fails its check)"
release 5.0.3
MARE_HEALTH_URL=http://127.0.0.1:9/app.js bash "$UPD" >/dev/null 2>&1
check "rolled back to 5.0.1" '[[ $(appv) == 5.0.1 && $(conf MARE_VERSION) == 5.0.1 ]]'
check "status says failed, the version is remembered" '[[ $(state) == failed && $(cat "$R/var/lib/mare/failed") == 5.0.3 ]]'
check "no leftovers" '[[ ! -e $R/var/www/mare.old && ! -e $R/var/www/mare.new ]]'
n=$(grep -c "caddy validate" "$T/calls.log"); bash "$UPD" >/dev/null 2>&1
check "the same release is not tried again" '[[ $(grep -c "caddy validate" "$T/calls.log") == "$n" && $(appv) == 5.0.1 ]]'
release 5.0.4; touch "$T/caddy-rejects"; bash "$UPD" >/dev/null 2>&1; rm -f "$T/caddy-rejects"
check "a release whose server configuration is rejected is not installed" '[[ $(appv) == 5.0.1 && $(state) == failed ]]'
release 5.0.5; bash "$UPD" >/dev/null 2>&1
check "the next good release (5.0.5) installs and clears the failure" '[[ $(appv) == 5.0.5 && $(state) == updated && ! -e $R/var/lib/mare/failed ]]'

echo "== 5. pinned to a version, and the off switch"
release 5.0.6
printf 'MARE_PIN=abc123\n' >> "$R/etc/mare.conf"; bash "$UPD" >/dev/null 2>&1
check "pinned: stays on 5.0.5, status says pinned" '[[ $(appv) == 5.0.5 && $(state) == pinned ]]'
sed -i '/^MARE_PIN=/d' "$R/etc/mare.conf"; printf 'MARE_AUTOUPDATE=0\n' >> "$R/etc/mare.conf"; bash "$UPD" >/dev/null 2>&1
check "switched off: stays on 5.0.5, status says off" '[[ $(appv) == 5.0.5 && $(state) == off ]]'
sed -i '/^MARE_AUTOUPDATE=/d' "$R/etc/mare.conf"; bash "$UPD" >/dev/null 2>&1
check "switched back on: installs 5.0.6" '[[ $(appv) == 5.0.6 && $(state) == updated ]]'

echo "RESULT: $([[ $FAIL == 0 ]] && echo OK || echo PROBLEMS)"
exit $FAIL
