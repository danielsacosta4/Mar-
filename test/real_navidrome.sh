#!/usr/bin/env bash
# A REAL Navidrome for the tests (test_navidrome.py), since an imitation hid the 1.6.0 stream bug.
#   test/real_navidrome.sh setup   downloads the official image (ghcr.io), unpacks it, makes a small FLAC library
#   test/real_navidrome.sh start   (re)starts it on 127.0.0.1:4533 with an EMPTY transcoding cache; admin / secret
#   test/real_navidrome.sh stop
# Needs curl, python3, ffmpeg and network access to ghcr.io + pkg-containers.githubusercontent.com. No Docker.
set -euo pipefail
DIR=${MARE_ND_DIR:-/tmp/mare-navidrome}; VER=${MARE_ND_VERSION:-0.64.2}; R=$DIR/root
case ${1:-} in
setup)
  mkdir -p "$R" "$DIR/music" "$DIR/data"
  if [[ ! -x $R/app/navidrome ]]; then
    T=$(curl -fsS "https://ghcr.io/token?scope=repository:navidrome/navidrome:pull" | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
    H=(-H "Authorization: Bearer $T")
    D=$(curl -fsS "${H[@]}" -H "Accept: application/vnd.oci.image.index.v1+json" "https://ghcr.io/v2/navidrome/navidrome/manifests/$VER" \
      | python3 -c "import sys,json;print([m['digest'] for m in json.load(sys.stdin)['manifests'] if m['platform']['architecture']=='amd64' and m['platform']['os']=='linux'][0])")
    for L in $(curl -fsS "${H[@]}" -H "Accept: application/vnd.oci.image.manifest.v1+json" "https://ghcr.io/v2/navidrome/navidrome/manifests/$D" \
      | python3 -c "import sys,json;[print(l['digest']) for l in json.load(sys.stdin)['layers']]"); do
      curl -fsSL "${H[@]}" -o "$DIR/layer.tgz" "https://ghcr.io/v2/navidrome/navidrome/blobs/$L"; tar xzf "$DIR/layer.tgz" -C "$R" 2>/dev/null || true
    done
    rm -f "$DIR/layer.tgz"
  fi
  # Two albums of six songs: chords + a moving tone + pink noise, so the encoders behave as with real music.
  python3 - "$DIR/music" <<'PY'
import subprocess, os, sys
os.chdir(sys.argv[1])
for ar, al, yr, g, ds in [("Marta Fado", "Saudade", 1979, "Fado", [62, 75, 58, 90, 66, 71]), ("The Northern Lights", "Night Drive", 1985, "Synthpop", [80, 64, 95, 70, 60, 88])]:
    os.makedirs(f"{ar}/{al}", exist_ok=True)
    for i, d in enumerate(ds, 1):
        f = f"{ar}/{al}/{i:02d} - {al} Song {i}.flac"
        if os.path.exists(f): continue
        subprocess.run(['ffmpeg', '-v', '0', '-y', '-f', 'lavfi', '-i', f'sine=f={220+i*30}:d={d}', '-f', 'lavfi', '-i', f'sine=f={330+i*45}:d={d}',
            '-f', 'lavfi', '-i', f'anoisesrc=d={d}:c=pink:a=0.3', '-filter_complex', 'amix=inputs=3:duration=first,tremolo=f=4:d=0.6',
            '-ac', '2', '-ar', '44100', '-sample_fmt', 's16', '-c:a', 'flac', '-metadata', f'title={al} Song {i}', '-metadata', f'artist={ar}',
            '-metadata', f'album={al}', '-metadata', f'album_artist={ar}', '-metadata', f'track={i}', '-metadata', f'date={yr}', '-metadata', f'genre={g}', f], check=True)
PY
  "$R/lib/ld-musl-x86_64.so.1" --library-path "$R/lib:$R/usr/lib" "$R/app/navidrome" --version ;;
start)
  pkill -f "app/navidrome" 2>/dev/null || true; sleep 1; rm -rf "$DIR/data/cache/transcoding"
  # The binary is built for Alpine: run it through the image's own loader. The scanner must stay in-process
  # (as a subprocess it would re-run the loader, not Navidrome).
  ND_MUSICFOLDER=$DIR/music ND_DATAFOLDER=$DIR/data ND_PORT=4533 ND_ADDRESS=127.0.0.1 ND_LOGLEVEL=debug ND_DEVEXTERNALSCANNER=false \
  ND_DEVAUTOCREATEADMINPASSWORD=secret ND_FFMPEGPATH=$(command -v ffmpeg) ND_ENABLEINSIGHTSCOLLECTOR=false ND_SCANNER_SCANONSTARTUP=true \
    nohup "$R/lib/ld-musl-x86_64.so.1" --library-path "$R/lib:$R/usr/lib" "$R/app/navidrome" > "$DIR/navidrome.log" 2>&1 &
  for _ in $(seq 30); do curl -fsS -o /dev/null "http://127.0.0.1:4533/rest/ping" 2>/dev/null && break; sleep 0.5; done; sleep 3; echo "Navidrome $VER on http://127.0.0.1:4533" ;;
stop) pkill -f "app/navidrome" 2>/dev/null || true ;;
*) echo "usage: $0 setup|start|stop" >&2; exit 1 ;;
esac
