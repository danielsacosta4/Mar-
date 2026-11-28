#!/usr/bin/env bash
# ============================================================================
#  Maré — Navidrome web client · all-in-one installer for Proxmox VE
#  Run on the Proxmox host shell:
#    bash -c "$(curl -fsSL https://raw.githubusercontent.com/danielsacosta4/Mar-/main/mare.sh)"
#  or, with the file copied over:   bash mare.sh
#
#  First run : creates a Debian LXC, installs Caddy, installs Maré and
#              connects it to Navidrome.
#  Next runs : finds the Maré container and updates it in place
#              (your settings are kept).
#  In between: the container checks GitHub every hour and installs new
#              releases by itself (mare.sh --apply, run by mare-update).
#
#  The app itself is downloaded from the Maré repository on GitHub (the
#  same version as this script); the Debian template and Caddy come from
#  their own repositories.
# ============================================================================
set -Eeuo pipefail
# The new container has no locales yet; use the built-in one so apt/perl stay quiet.
export LANG=C.UTF-8 LC_ALL=C.UTF-8
unset LANGUAGE

MARE_VERSION="1.8.4"
TAG="mare"
# Where the app comes from: the repository as a tarball (override for testing).
# To go back to an earlier release, set MARE_REF to that release's commit (listed with every release):
#   MARE_REF=<commit> bash -c "$(curl -fsSL https://raw.githubusercontent.com/danielsacosta4/Mar-/main/mare.sh)"
# Installing a chosen release also PINS it: the container then stops updating itself until this command is run plainly.
MARE_PIN=${MARE_REF:-}
MARE_REF=${MARE_REF:-refs/heads/main}
MARE_SOURCE=${MARE_SOURCE:-https://codeload.github.com/danielsacosta4/Mar-/tar.gz/$MARE_REF}
# The container checks GitHub every hour and installs new releases by itself. MARE_AUTOUPDATE=0 switches that off.
MARE_AUTOUPDATE=${MARE_AUTOUPDATE:-1}
APP_VERSION=

# ---------- look ----------
B=$'\e[1m'; D=$'\e[2m'; G=$'\e[32m'; R=$'\e[31m'; Y=$'\e[33m'; C=$'\e[36m'; N=$'\e[0m'
step() { printf '\n%s\n' "${B}${C}==>${N} ${B}$*${N}"; }
ok()   { printf '  %s %s\n' "${G}✓${N}" "$*"; }
warn() { printf '  %s %s\n' "${Y}!${N}" "$*"; }
die()  { printf '\n  %s %s\n\n' "${R}✗${N}" "${B}$*${N}" >&2; exit 1; }
trap 'die "Something failed on line $LINENO. Copy the output above and send it over."' ERR

ask() {   # ask VAR "Question" "default"
  local __v=$1 __q=$2 __d=${3:-} __a=""
  while :; do
    if [[ -n $__d ]]; then read -r -p "  $__q ${D}[$__d]${N}: " __a </dev/tty; __a=${__a:-$__d}
    else read -r -p "  $__q: " __a </dev/tty; fi
    [[ -n $__a ]] && break
  done
  printf -v "$__v" '%s' "$__a"
}
yesno() { # yesno "Question" Y|N
  local a; read -r -p "  $1 ${D}[$( [[ $2 == Y ]] && echo Y/n || echo y/N )]${N}: " a </dev/tty
  a=${a:-$2}; [[ $a =~ ^[Yy] ]]
}

banner() {
  printf '%s\n' "${B}"
  printf '   __  __                 \n'
  printf '  |  \\/  | __ _ _ __ ___  \n'
  printf '  | |\\/| |/ _` | '"'"'__/ _ \\ \n'
  printf '  | |  | | (_| | | |  __/ \n'
  printf '  |_|  |_|\\__,_|_|  \\___| %s\n' "${N}${D}v${MARE_VERSION} · Navidrome web client${N}"
  printf '\n'
}

# ---------- the app ----------
fetch_app() {   # fetch_app DIR -> the app's files in DIR, APP_VERSION set
  local tgz
  tgz=$(mktemp)
  curl -fsSL -m 120 --retry 3 "$MARE_SOURCE" -o "$tgz" \
    || { rm -f "$tgz"; die "Couldn't download Maré from GitHub. Check the host's internet access and try again; nothing was changed."; }
  mkdir -p "$1"
  tar xzf "$tgz" -C "$1" --strip-components=2 --wildcards '*/app/*' 2>/dev/null \
    || { rm -f "$tgz"; die "The download from GitHub was damaged. Try again; nothing was changed."; }
  rm -f "$tgz"
  [[ -f $1/index.html && -f $1/app.js ]] || die "The download from GitHub is missing the app. Try again; nothing was changed."
  APP_VERSION=$(grep -o "MARE_VERSION = '[^']*'" "$1/app.js" | head -1 | cut -d"'" -f2)
  APP_VERSION=${APP_VERSION:-$MARE_VERSION}
}

caddyfile() {   # caddyfile NAVIDROME_URL
  local url=${1%/} scheme hostport base rewrite="" tls=""
  scheme=$(sed -E 's#^(https?)://.*#\1#' <<<"$url")
  hostport=$(sed -E 's#^https?://([^/]+).*#\1#' <<<"$url")
  base=$(sed -E 's#^https?://[^/]+##' <<<"$url")
  [[ -n $base ]] && rewrite=$'\n'"		rewrite * ${base}{uri}"
  [[ $scheme == https ]] && tls=$'\n\t\t\ttransport http {\n\t\t\t\ttls_insecure_skip_verify\n\t\t\t}'
  cat <<EOF
# Maré — written by mare.sh; re-running the script rewrites this file.
{
	admin off
}

:80 {
	encode zstd gzip

	# Subsonic API, audio streams and cover art go to Navidrome.
	handle /rest/* {${rewrite}
		reverse_proxy ${scheme}://${hostport} {
			flush_interval -1
			header_up Host {upstream_hostport}
			# Maré itself is reached over plain http (from the proxy in front of it). Passed on, that reads as "this
			# request began insecure", and a proxy in front of Navidrome then answers every call with a redirect.
			header_up X-Forwarded-Proto ${scheme}${tls}
		}
	}

	# MusicBrainz (discographies), with the User-Agent MusicBrainz asks clients to send.
	handle_path /mb/* {
		rewrite * /ws/2{uri}
		reverse_proxy https://musicbrainz.org {
			header_up Host musicbrainz.org
			header_up User-Agent "Mare/${MARE_VERSION%.*} ( https://github.com/danielsacosta4/Mar- )"
			header_up -X-Forwarded-For
			header_up -X-Real-IP
		}
	}

	# MusicBrainz sign-in (sending star ratings): token exchange without CORS trouble.
	handle_path /mbo/* {
		rewrite * /oauth2{uri}
		reverse_proxy https://musicbrainz.org {
			header_up Host musicbrainz.org
			header_up User-Agent "Mare/${MARE_VERSION%.*} ( https://github.com/danielsacosta4/Mar- )"
			header_up -X-Forwarded-For
			header_up -X-Real-IP
		}
	}

	# ListenBrainz API (personal playlists, stats, radio), so the browser only talks to this server.
	handle_path /lb/* {
		reverse_proxy https://api.listenbrainz.org {
			header_up Host api.listenbrainz.org
			header_up -X-Forwarded-For
			header_up -X-Real-IP
		}
	}

	# The app.
	handle {
		root * /var/www/mare
		@shell path / /index.html *.js *.css /manifest.webmanifest
		header @shell Cache-Control "no-cache"
		@fonts path /fonts/*
		header @fonts Cache-Control "public, max-age=2592000"
		try_files {path} /index.html
		file_server
	}
}
EOF
}

write_conf() {   # write_conf NAVIDROME VERSION PIN AUTOUPDATE
  printf 'NAVIDROME=%q\nMARE_VERSION=%q\nMARE_PIN=%q\nMARE_AUTOUPDATE=%q\n' "$1" "$2" "$3" "$4"
}

# ---------- self-update (inside the container) ----------
# The bootstrap the timer runs every hour. Small on purpose: it only finds out whether GitHub has another version and
# then hands over to that release's own mare.sh (--apply), so the install logic always matches the release.
updater_script() {
  cat <<'EOF'
#!/usr/bin/env bash
# Maré self-update. Written by mare.sh; every update rewrites it. Runs from mare-update.timer.
set -u
ROOT=${MARE_ROOT:-}
CONF=$ROOT/etc/mare.conf
[ -r "$CONF" ] || exit 0
. "$CONF"
STATUS=$ROOT/var/www/mare/update.json
RAW=${MARE_RAW:-https://raw.githubusercontent.com/danielsacosta4/Mar-/main}
SRC=${MARE_SOURCE:-https://codeload.github.com/danielsacosta4/Mar-/tar.gz/refs/heads/main}
say() {   # say STATE NOTE -> the line Settings shows
  printf '{"checked":"%s","installed":"%s","state":"%s","note":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${MARE_VERSION:-}" "$1" "$2" \
    > "$STATUS.tmp" 2>/dev/null && mv "$STATUS.tmp" "$STATUS" && chmod a+r "$STATUS"
}
[ "${MARE_AUTOUPDATE:-1}" = 1 ] || { say off "Automatic updates are switched off"; exit 0; }
[ -z "${MARE_PIN:-}" ] || { say pinned "Kept on this version on purpose"; exit 0; }
latest=$(curl -fsSL -m 30 "$RAW/app/sw.js" 2>/dev/null | grep -o "VERSION = '[^']*'" | head -1 | cut -d"'" -f2)
[ -n "$latest" ] || { say offline "Could not reach GitHub"; exit 0; }
[ "$latest" != "${MARE_VERSION:-}" ] || { say current ""; exit 0; }
if [ "$latest" = "$(cat "$ROOT/var/lib/mare/failed" 2>/dev/null)" ]; then
  say failed "Version $latest did not start here and was undone. Waiting for the next release."; exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if ! curl -fsSL -m 180 --retry 3 "$SRC" -o "$tmp/src.tgz" 2>/dev/null \
  || ! tar xzf "$tmp/src.tgz" -C "$tmp" --strip-components=1 2>/dev/null \
  || [ ! -f "$tmp/mare.sh" ] || [ ! -f "$tmp/app/app.js" ]; then
  say offline "The download of version $latest failed. Trying again in an hour."; exit 0
fi
bash "$tmp/mare.sh" --apply "$tmp"
EOF
}

updater_service() {
  printf '%s\n' '[Unit]' 'Description=Maré: check GitHub for a new release and install it' 'After=network-online.target' '' \
    '[Service]' 'Type=oneshot' 'ExecStart=/usr/local/bin/mare-update'
}
updater_timer() {
  printf '%s\n' '[Unit]' 'Description=Maré: hourly update check' '' \
    '[Timer]' 'OnBootSec=2min' 'OnUnitActiveSec=1h' 'RandomizedDelaySec=5min' '' '[Install]' 'WantedBy=timers.target'
}

# Write the updater into the container's file system (ROOT is only non-empty in tests) and switch its timer on or off.
install_updater_local() {   # install_updater_local AUTOUPDATE
  local root=${MARE_ROOT:-}
  mkdir -p "$root/usr/local/bin" "$root/etc/systemd/system" "$root/var/lib/mare"
  updater_script >"$root/usr/local/bin/mare-update"; chmod 755 "$root/usr/local/bin/mare-update"
  updater_service >"$root/etc/systemd/system/mare-update.service"
  updater_timer >"$root/etc/systemd/system/mare-update.timer"
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [[ $1 == 1 ]]; then systemctl enable -q --now mare-update.timer >/dev/null 2>&1 || true
  else systemctl disable -q --now mare-update.timer >/dev/null 2>&1 || true; fi
}

# mare.sh --apply DIR: install the release unpacked in DIR, from inside the container. Undoes itself if Maré
# doesn't answer with the new version afterwards.
apply_local() {
  local src=$1 root=${MARE_ROOT:-} conf www cf nav was pin auto new changed=0 okh=0 url
  trap - ERR
  conf=$root/etc/mare.conf; www=$root/var/www; cf=$root/etc/caddy/Caddyfile
  [[ -r $conf && -f $src/app/app.js ]] || { echo "mare.sh --apply: nothing to do here" >&2; exit 1; }
  nav=$(. "$conf"; printf %s "${NAVIDROME:-}"); was=$(. "$conf"; printf %s "${MARE_VERSION:-}")
  pin=$(. "$conf"; printf %s "${MARE_PIN:-}"); auto=$(. "$conf"; printf %s "${MARE_AUTOUPDATE:-1}")
  new=$(grep -o "MARE_VERSION = '[^']*'" "$src/app/app.js" | head -1 | cut -d"'" -f2)
  url=${MARE_HEALTH_URL:-http://127.0.0.1/app.js}
  status() {   # status INSTALLED STATE NOTE
    printf '{"checked":"%s","installed":"%s","state":"%s","note":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" >"$www/mare/update.json"
    chmod a+r "$www/mare/update.json"
  }
  refuse() {   # refuse NOTE: this release is not installed and not tried again
    mkdir -p "$root/var/lib/mare"; printf '%s\n' "$new" >"$root/var/lib/mare/failed"
    status "$was" failed "$1"; echo "mare-update: $1" >&2; exit 1
  }
  [[ -n $new && -n $nav ]] || refuse "Version ${new:-?} could not be read; it was not installed."

  rm -rf "$www/mare.new" "$www/mare.old"; mkdir -p "$www/mare.new"
  cp -a "$src/app/." "$www/mare.new/" && chmod -R a+rX "$www/mare.new" || { rm -rf "$www/mare.new"; refuse "Version $new could not be copied; it was not installed."; }
  caddyfile "$nav" >"$cf.new"
  if ! caddy validate --config "$cf.new" --adapter caddyfile >/dev/null 2>&1; then
    rm -rf "$www/mare.new" "$cf.new"; refuse "Version $new has a server configuration this container rejects; it was not installed."
  fi
  cmp -s "$cf.new" "$cf" || changed=1

  mv "$www/mare" "$www/mare.old" && mv "$www/mare.new" "$www/mare"
  if ((changed)); then cp -p "$cf" "$cf.old"; mv "$cf.new" "$cf"; systemctl restart caddy || true; else rm -f "$cf.new"; fi
  for _ in $(seq 1 10); do
    if curl -fsS -m 5 "$url" 2>/dev/null | grep -q "MARE_VERSION = '$new'"; then okh=1; break; fi
    sleep "${MARE_HEALTH_WAIT:-2}"
  done
  if ((!okh)); then   # put everything back
    rm -rf "$www/mare"; mv "$www/mare.old" "$www/mare"
    if ((changed)); then mv "$cf.old" "$cf"; systemctl restart caddy || true; fi
    refuse "Version $new did not start here and was undone. Waiting for the next release."
  fi

  write_conf "$nav" "$new" "$pin" "$auto" >"$conf"
  rm -rf "$www/mare.old" "$cf.old" "$root/var/lib/mare/failed"
  install_updater_local "$auto"
  status "$new" updated "Updated from ${was:-an earlier version}"
  echo "mare-update: installed $new (was ${was:-?})"
}

# Host side: put the updater into the container and let it report straight away.
push_updater() {   # push_updater CTID
  local id=$1 tmp
  tmp=$(mktemp -d)
  updater_script >"$tmp/mare-update"; updater_service >"$tmp/mare-update.service"; updater_timer >"$tmp/mare-update.timer"
  pct push "$id" "$tmp/mare-update" /usr/local/bin/mare-update
  pct push "$id" "$tmp/mare-update.service" /etc/systemd/system/mare-update.service
  pct push "$id" "$tmp/mare-update.timer" /etc/systemd/system/mare-update.timer
  pct exec "$id" -- sh -c "
    chmod 755 /usr/local/bin/mare-update; mkdir -p /var/lib/mare; rm -f /var/lib/mare/failed
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [ '$MARE_AUTOUPDATE' = 1 ]; then systemctl enable -q --now mare-update.timer >/dev/null 2>&1 || true
    else systemctl disable -q --now mare-update.timer >/dev/null 2>&1 || true; fi
    systemctl start --no-block mare-update.service >/dev/null 2>&1 || true"
  rm -rf "$tmp"
}
updates_line() {
  if [[ $MARE_AUTOUPDATE != 1 ]]; then echo "automatic updates are off; run this command again to update"
  elif [[ -n $MARE_PIN ]]; then echo "kept on this version; run the plain install command to follow new releases again"
  else echo "Maré checks GitHub every hour and installs new releases by itself"; fi
}

normalise_url() { local u=${1%/}; [[ $u =~ ^https?:// ]] || u="http://$u"; printf '%s' "$u"; }

ct_ip() { pct exec "$1" -- sh -c "hostname -I 2>/dev/null | awk '{print \$1}'" 2>/dev/null || true; }

wait_for_network() {
  local id=$1 i
  for i in $(seq 1 30); do
    if pct exec "$id" -- sh -c 'getent hosts deb.debian.org >/dev/null 2>&1'; then return 0; fi
    sleep 2
  done
  die "Container $id has no internet access (can't resolve deb.debian.org). Check the bridge/IP/gateway."
}

push_app() {   # push_app CTID NAVIDROME_URL
  local id=$1 nav=$2 tmp
  tmp=$(mktemp -d)
  tar czf "$tmp/mare.tgz" -C "$APPDIR" .
  caddyfile "$nav" >"$tmp/Caddyfile"
  write_conf "$nav" "$APP_VERSION" "$MARE_PIN" "$MARE_AUTOUPDATE" >"$tmp/mare.conf"
  pct push "$id" "$tmp/mare.tgz" /tmp/mare.tgz
  pct push "$id" "$tmp/Caddyfile" /etc/caddy/Caddyfile
  pct push "$id" "$tmp/mare.conf" /etc/mare.conf
  pct exec "$id" -- sh -c '
    set -e
    rm -rf /var/www/mare.new && mkdir -p /var/www/mare.new
    tar xzf /tmp/mare.tgz -C /var/www/mare.new && rm -f /tmp/mare.tgz
    rm -rf /var/www/mare.old
    [ -d /var/www/mare ] && mv /var/www/mare /var/www/mare.old
    mv /var/www/mare.new /var/www/mare && rm -rf /var/www/mare.old
    chmod -R a+rX /var/www/mare
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
      || { caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; exit 1; }
    systemctl enable -q caddy && systemctl restart caddy
    # Log the Proxmox console straight in as root, like Community Scripts containers.
    if [ -d /etc/systemd/system ] && [ ! -f /etc/systemd/system/container-getty@1.service.d/override.conf ]; then
      mkdir -p /etc/systemd/system/container-getty@1.service.d
      printf "[Service]\nExecStart=\nExecStart=-/sbin/agetty --autologin root --noclear --keep-baud tty%%I 115200,38400,9600 \$TERM\n" \
        > /etc/systemd/system/container-getty@1.service.d/override.conf
      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl restart container-getty@1.service >/dev/null 2>&1 || true
    fi'
  rm -rf "$tmp"
}

check_navidrome() {   # check_navidrome CTID URL -> 0 if it answers
  pct exec "$1" -- sh -c "curl -fsS -m 8 '$2/rest/ping.view' 2>/dev/null | grep -q subsonic-response"
}
# The same question asked the way the app asks it: through Maré's own web server. (On 28 Nov 2026 Navidrome answered
# the container directly while every call through Maré was redirected, and this script said all was well.)
check_through_mare() {   # check_through_mare CTID -> 0 if Navidrome answers through Maré
  pct exec "$1" -- sh -c "curl -fsS -m 12 'http://127.0.0.1/rest/ping.view' 2>/dev/null | grep -q subsonic-response"
}
navidrome_report() {   # navidrome_report CTID URL
  if check_through_mare "$1"; then ok "Navidrome answers through Maré"
  elif check_navidrome "$1" "$2"; then warn "Navidrome answers at $2, but not through Maré. Send this line to Claude."
  else warn "Navidrome didn't answer at $2"; fi
}

# ============================================================================
# Inside the container, called by the updater with a freshly downloaded release.
if [[ ${1:-} == --apply ]]; then apply_local "${2:?usage: mare.sh --apply DIR}"; exit 0; fi

banner

command -v pct >/dev/null && command -v pveam >/dev/null \
  || die "Run this on the Proxmox host shell (Datacenter → your node → Shell), not inside a container."
[[ $EUID -eq 0 ]] || die "Run as root."

# Download the app before touching anything.
step "Downloading Maré"
APPDIR=$(mktemp -d)
trap 'rm -rf "$APPDIR"' EXIT
fetch_app "$APPDIR"
ok "Maré v$APP_VERSION downloaded"

# ---------- existing install? ----------
EXISTING=""
for f in /etc/pve/lxc/*.conf; do
  [[ -e $f ]] || continue
  if grep -Eq "^tags:.*(^|[;, ])${TAG}([;, ]|$)" "$f" || grep -Eq "^tags: *${TAG} *$" "$f"; then
    EXISTING=$(basename "$f" .conf); break
  fi
done

if [[ -n $EXISTING ]]; then
  HN=$(awk -F': ' '/^hostname:/{print $2}' "/etc/pve/lxc/$EXISTING.conf")
  step "Found Maré in container $EXISTING ($HN)"
  if yesno "Update it to v$APP_VERSION?" Y; then
    [[ $(pct status "$EXISTING") == *running* ]] || { pct start "$EXISTING"; sleep 3; }
    NAV=$(pct exec "$EXISTING" -- sh -c '. /etc/mare.conf 2>/dev/null; printf %s "$NAVIDROME"' || true)
    if [[ -z $NAV ]] || yesno "Change the Navidrome address (now: ${NAV:-not set})?" N; then
      ask NAV "Navidrome address (e.g. 192.168.1.40:4533)" "${NAV:-}"
      NAV=$(normalise_url "$NAV")
    fi
    step "Updating"
    push_app "$EXISTING" "$NAV"
    push_updater "$EXISTING"
    ok "Maré v$APP_VERSION installed"
    ok "Updates: $(updates_line)"
    navidrome_report "$EXISTING" "$NAV"
    IP=$(ct_ip "$EXISTING")
    printf '\n  %s\n  Open: http://%s\n\n' "${G}${B}Done.${N}" "${IP:-<container IP>}"
    exit 0
  fi
  yesno "Create a second, separate Maré container instead?" N || exit 0
fi

# ---------- settings ----------
step "Navidrome"
echo "  ${D}The address you use for Navidrome on your network. Add /path if it has a BaseUrl.${N}"
ask NAV "Navidrome address (e.g. 192.168.1.40:4533)"
NAV=$(normalise_url "$NAV")

CTID=$(pvesh get /cluster/nextid)
HOSTNAME_CT="mare"
CORES=1; RAM=256; DISK=2
BRIDGE="vmbr0"
NET="dhcp"; GW=""
ROOT_STORE=$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}' | grep -m1 -E '^local-lvm$' \
  || pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')
TPL_STORE=$(pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active"{print $1}' | grep -m1 -E '^local$' \
  || pvesm status -content vztmpl 2>/dev/null | awk 'NR>1 && $3=="active"{print $1; exit}')
[[ -n $ROOT_STORE ]] || die "No storage for containers found."
[[ -n $TPL_STORE ]] || die "No storage for templates found."

step "Container"
printf '  %-14s %s\n' "ID" "$CTID" "Name" "$HOSTNAME_CT" "CPU / RAM" "$CORES core / ${RAM} MB" \
  "Disk" "${DISK} GB on $ROOT_STORE" "Network" "$BRIDGE, DHCP" "Starts on boot" "yes"
if ! yesno "Use these settings?" Y; then
  ask CTID "Container ID" "$CTID"
  ask HOSTNAME_CT "Name" "$HOSTNAME_CT"
  echo "  ${D}Storages: $(pvesm status -content rootdir | awk 'NR>1 && $3=="active"{printf "%s ", $1}')${N}"
  ask ROOT_STORE "Disk storage" "$ROOT_STORE"
  ask DISK "Disk size (GB)" "$DISK"
  ask RAM "RAM (MB)" "$RAM"
  ask BRIDGE "Network bridge" "$BRIDGE"
  ask NET "IP address with mask (e.g. 192.168.1.60/24) or dhcp" "$NET"
  if [[ $NET != dhcp ]]; then ask GW "Gateway" "$(ip route | awk '/^default/{print $3; exit}')"; fi
fi
pct status "$CTID" >/dev/null 2>&1 && die "Container ID $CTID is already in use."

# ---------- template ----------
step "Debian template"
pveam update >/dev/null 2>&1 || warn "Couldn't refresh the template list; using what's known."
TPL=$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-13-standard_.*_amd64\.tar\.(zst|xz|gz)$' | sort -V | tail -1 || true)
[[ -n $TPL ]] || TPL=$(pveam available --section system 2>/dev/null | awk '{print $2}' | grep -E '^debian-12-standard_.*_amd64\.tar\.(zst|xz|gz)$' | sort -V | tail -1 || true)
[[ -n $TPL ]] || die "Couldn't find a Debian template. Check the host's internet access."
if pveam list "$TPL_STORE" 2>/dev/null | grep -q "$TPL"; then
  ok "$TPL already downloaded"
else
  pveam download "$TPL_STORE" "$TPL" >/dev/null
  ok "Downloaded $TPL"
fi

# ---------- create ----------
step "Creating container $CTID"
NETCFG="name=eth0,bridge=$BRIDGE,ip=$NET"
[[ $NET != dhcp ]] && NETCFG+=",gw=$GW"
pct create "$CTID" "$TPL_STORE:vztmpl/$TPL" \
  --hostname "$HOSTNAME_CT" --cores "$CORES" --memory "$RAM" --swap 256 \
  --rootfs "$ROOT_STORE:$DISK" --net0 "$NETCFG" \
  --unprivileged 1 --features nesting=1 --onboot 1 --tags "$TAG" \
  --description "Maré — Navidrome web client. It updates itself from GitHub; the install command on the host also updates it." >/dev/null
pct start "$CTID"
ok "Container $CTID created and started"

step "Installing Caddy"
wait_for_network "$CTID"
pct exec "$CTID" -- sh -c 'export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq caddy curl ca-certificates >/dev/null
  apt-get -y -qq upgrade >/dev/null 2>&1 || true'
ok "Caddy installed"

step "Installing Maré v$APP_VERSION"
push_app "$CTID" "$NAV"
push_updater "$CTID"
ok "App installed and Caddy configured"

step "Checking"
if check_navidrome "$CTID" "$NAV"; then ok "Navidrome answers at $NAV"
else warn "Navidrome didn't answer at $NAV — the app will load, but sign-in will fail until it does. Run the script again to change the address."; fi

IP=""
for _ in $(seq 1 10); do IP=$(ct_ip "$CTID"); [[ -n $IP ]] && break; sleep 2; done
SERVING=0
for _ in $(seq 1 10); do
  if [[ -n $IP ]] && curl -fsS -m 5 "http://$IP/" 2>/dev/null | grep -q '<title>Maré'; then SERVING=1; break; fi
  sleep 2
done
if ((SERVING)); then ok "Maré is serving on http://$IP"
else warn "Couldn't reach http://${IP:-?} from the host yet; give it a few seconds."; fi

cat <<EOF

  ${G}${B}Maré is installed.${N}

  Open        http://${IP:-<container IP>}
  NPMplus     point your music subdomain at http://${IP:-<container IP>} port 80
  Updates     $(updates_line)
  Container   $CTID ($HOSTNAME_CT)

EOF
exit 0
