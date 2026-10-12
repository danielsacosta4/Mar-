# Maré: project guide for Claude

Maré is a self-hosted web client for **Navidrome** (Subsonic/OpenSubsonic API) with an Apple Music–style
interface and Spotify-style discovery built on **ListenBrainz**. It is a personal project: one user, their own server.

## Working with the owner

- **Plan first, then wait for a go-ahead** before starting any new feature or task. Explain what you'll build in plain terms.
- Talk in **English** (the owner is Portuguese and practises English here).
- Don't include "how to paste/install this" steps when delivering code; they consider that noise.
- Every release ends with a **ready-to-paste commit message** (title + short bullet description).
- The owner is not a developer. Explain choices by what they change for the listener, not by implementation.

## The owner's setup

- **Proxmox VE** host ("pve") running many LXCs installed with Community Scripts (community-scripts.org).
- **Navidrome** (latest, 0.6x) runs as an app on a **TrueNAS** VM (VM 102) on the same host.
- **NPMplus** (LXC 114) is the reverse proxy; HTTPS domain `*.servidorcasinha.com`.
- Maré runs in its own **Debian LXC tagged `mare`**, created by `mare.sh`; it serves the app with **Caddy** on port 80.
  NPMplus points a subdomain at it. Navidrome itself is reached by Caddy (the owner chose the public
  `https://navidrome.servidorcasinha.com` address; the LAN `ip:port` is also supported).
- Music library: mostly **Qobuz downloads** (FLAC, often 24-bit hi-res). Files usually have **no MusicBrainz IDs**
  and **no ReplayGain tags**, so matching is done by artist + title, and volume levelling needs tags to be added
  (suggested: rsgain; not done yet).
- ListenBrainz user: `modren12` (token entered in the app, stored only in the browser's localStorage).
- Install / update command, run on the Proxmox host shell:

      bash -c "$(curl -fsSL https://raw.githubusercontent.com/danielsacosta4/Mar-/main/mare.sh)"

## Repository layout

```
app/            The web app (static files, no framework, no build step needed to run)
  index.html    Shell: sidebar, main, player bar, Now Playing overlay, tab bar
  app.css       All styles, "Sleeve" design (light "paper" / dark "night edition" via prefers-color-scheme,
                mobile at ≤760px, NP stacks at ≤1000px)
  fonts/        Archivo (condensed display + UI) and Newsreader (serif), latin subsets, OFL. NOT embedded in
                mare.sh: the installer downloads them from GitHub (main branch) at install time.
  app.js        Core: API client (token auth, MD5), song registry, Player (2-element engine), views, router, UI
  discover.js   Round 2: ListenBrainz client, library matching, Radio, Lyrics, Home discovery rows, Settings view
  extras.js     Round 3: quality badges, playlist editing, drag-to-reorder, offline downloads, A–Z artists,
                playback settings. Wraps/extends functions from app.js and discover.js.
  sw.js         Service worker: app shell cache, downloaded songs (with Range support) and covers
build/
  mare.sh.in    Installer template (bash). __VERSION__ is replaced; the app is appended after __MARE_PAYLOAD__
  build.sh      build/build.sh <version>  -> writes ./mare.sh (minify -> tar -> xz -> base64)
  minify.py     Safe minifier (comments + indentation only)
test/
  mock_server.py  Mock Navidrome (/rest) + ListenBrainz (/lb/1) + static files, port 8765. User demo / secret
  test_*.py       Playwright browser tests (desktop + mobile, light + dark); screenshots to test-output/
  run.sh          Starts the mock and runs all suites
  fakepve/        Fake pct/pveam/pvesh/pvesm/systemctl to exercise mare.sh without Proxmox
mare.sh         The built installer; this is what the owner's curl command downloads. Commit it with every release.
```

Scripts load in order `app.js` → `discover.js` → `extras.js`; later files use top-level bindings of earlier ones
(`API`, `Player`, `UI`, `View`, `actions`, `store`, `register`, `icon`, `STROKE`, …) and patch them by wrapping
(e.g. `UI.render`, `UI.renderQueue`, `UI.syncPlayer`, `songMenu`, `View.settings`, `API.call`).

## How things work

- **Auth**: Subsonic token auth (`t = md5(password + salt)`), session in localStorage `mare.session`.
  `API.base` is empty when served by the Maré container (same origin; Caddy proxies `/rest/*` to Navidrome).
- **Caddy routes** (written by mare.sh): `/rest/*` → Navidrome (optional BaseUrl rewrite, streaming flush),
  `/lb/*` → `https://api.listenbrainz.org` (prefix stripped, so the browser never needs CORS), everything else → app
  with `index.html` fallback. App shell files are served `Cache-Control: no-cache`.
- **Player** (`app.js`): two `Audio` elements. `tick()` (every 100 ms) preloads the next song into the spare element
  ~40 s before the end, then either schedules a precise gapless switch (`advance(i, 0)`) or starts an equal-power
  crossfade. "Keep albums gapless" disables the fade between songs of the same album. If preloading isn't ready,
  the `ended` event falls back to `load()`, which reuses the preloaded element when it matches.
  Volume = user volume × ReplayGain (track/album/auto, peak-limited, never above 1) × fade factor.
  iOS/iPadOS can't set element volume (`Player.volLocked`), so crossfade and levelling are disabled there.
- **Scrobbling**: `scrobble` (now playing + submission after half the song or 4 min of real listening).
  Failed submissions are queued in localStorage and flushed when back online. ListenBrainz receives plays via
  Navidrome's own ListenBrainz integration.
- **Discovery** (`discover.js`): Made for You = ListenBrainz `createdfor` playlists (newest per kind);
  top artists/songs = LB stats; matching to the library via `search3` (normalised artist + title, cached in localStorage).
  Radio uses Navidrome `getSimilarSongs2` (Navidrome's agents include ListenBrainz and Deezer) and refills the
  queue as it runs low; "Recommended Radio" uses LB Radio (`/1/explore/lb-radio`, token required, rate-limited ~5 per window).
- **Design ("Sleeve", 1.3)**: flat colour, square corners, thick black rules, huge condensed capitals (Archivo at
  `font-stretch: 62%`) and a serif (Newsreader) for reading text. Each album's main colour (`extractTint`: strongest
  hue family of the cover, not the average) fills album/playlist/artist headers, the Home feature and Now Playing;
  `setColour` also sets `--on-tint` (black or off-white, whichever contrasts more) and `data-ink`. Accent red is for
  "now playing" and progress only. Home is a weekly front page (`renderFront` in app.js; data from `Discover.weekly`
  = LB stats `this_week`, falling back to last `week`, then to Navidrome play counts). Album pages split into
  Side A / Side B at half the running time (discs when multi-disc), with credits from OpenSubsonic `contributors`,
  `recordLabels`, `releaseDate`, and liner notes from `getAlbumInfo2`. Clicking a cover uses the View Transitions API
  to grow it into the album page (`UI.coverFrom`); other page changes do a short slide (`.main.turn`).
- **Lyrics**: OpenSubsonic `getLyricsBySongId` (synced first), fallback `getLyrics`.
- **Downloads** (`extras.js` + `sw.js`): songs fetched and stored in Cache Storage under `/offline/song/<id>`,
  covers under `/offline/art/<id>`; the service worker serves them (with HTTP Range) for any `/rest/stream?id=`.
  Index in localStorage `mare.downloads`. Needs a secure context (the HTTPS address); not available on plain LAN http.
- **Offline mode**: `API.call` is wrapped; a network failure sets `Offline.offline`, shows a banner, and routing
  falls back to downloaded items / the Downloads page.

## Building and releasing

1. Change files in `app/` (bump `window.MARE_VERSION` in `app.js` and `VERSION` in `sw.js` together).
2. `build/build.sh <version>` → new `mare.sh`. Keep it under ~120 KB: the `bash -c "$(curl …)"` one-liner passes
   the whole script as a single argument and Linux caps that at 128 KiB (currently ~85 KB). If it ever gets close,
   switch the install line to download-then-run, or fetch the app from the repo instead of embedding it.
   The fonts in `app/fonts/` are already fetched this way (`fetch_fonts` in mare.sh.in, from `MARE_ASSETS`, default
   raw.githubusercontent.com/…/main/app); if the download fails the previous fonts are kept, else system fonts.
3. `test/run.sh` (mock server + Playwright). Also worth a run of mare.sh with `test/fakepve` on PATH and a `caddy`
   binary available, then pointing the tests at `MARE_URL=http://127.0.0.1/` to test the installed, minified build.
   Set `MARE_ASSETS=http://127.0.0.1:8765` so the fonts come from the mock server instead of GitHub.
4. Commit `app/`, `build/`, `test/` and `mare.sh`; give the owner a commit message.

The installer on a re-run finds the container by its `mare` tag and only replaces the app + Caddyfile
(Navidrome address kept in `/etc/mare.conf` inside the container). It also sets console autologin and
uses `LANG=C.UTF-8` to avoid locale noise.

## History

- **1.0**: library, search, player with queue, Now Playing, Home feed from Navidrome data; LXC + Caddy installer.
- **1.0.1**: installer locale warnings fixed.
- **1.1.0**: ListenBrainz connect, Made for You, top songs/artists, radio (song/album/artist/genre/decade/station/
  recommended), synced lyrics, Settings page, `/lb` proxy, console autologin.
- **1.2.0**: gapless + crossfade engine, ReplayGain levelling, hi-res badges, streaming/download quality,
  playlist create/rename/delete/reorder/add/remove, draggable Up Next, offline downloads, A–Z artists, infinite scroll.
- **1.3.0** "Sleeve": full redesign chosen by the owner from three directions (Tide / Sleeve / Hi-fi). Weekly front
  page Home, record-sleeve album pages (sides, credits, liner notes), magazine artist profiles, A–Z dividers,
  album-colour Now Playing, night edition, self-hosted fonts fetched by the installer.

## Roadmap (agreed with the owner; each needs a plan + go-ahead first)

Part 2, "only Maré does this":
1. **New Releases for You**: new releases from artists the user listens to (ListenBrainz fresh releases),
   marked as in library / not yet (a Qobuz shopping list).
2. **Complete the Discography**: owned vs missing albums per artist (MusicBrainz release groups).
3. **Time machine**: "on this day last year", any-time year in review (ListenBrainz listens/stats).
4. **Moments**: Home adapts to time of day/week based on real listening.
5. **Album as a story**: credits, release info, artist background, animated covers.
6. **Maré Connect**: handoff between devices and phone-as-remote (needs a small service in the container).

Open notes: help the owner add ReplayGain tags (rsgain on TrueNAS); real-world check of LB matching quality
with Qobuz titles ("Remastered" etc.).
