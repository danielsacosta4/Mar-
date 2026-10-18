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
  fonts/        Archivo (condensed display + UI) and Newsreader (serif), latin subsets, OFL.
  app.js        Core: API client (token auth, MD5), song registry, Player (2-element engine), views, router, UI
  discover.js   Round 2: ListenBrainz client, library matching, Radio, Lyrics, Home discovery rows, Settings view
  extras.js     Round 3: quality badges, playlist editing, drag-to-reorder, offline downloads, A–Z artists,
                playback settings. Wraps/extends functions from app.js and discover.js.
  collection.js Round 4: library Catalog (per-album quality summary), quality labels on cards, album spec sheet,
                Collection page (#/collection), star ratings (setRating), Top Rated / 5-star mix, context menus.
  shopping.js   Round 5a: MusicBrainz client (MB), discographies (Disco) on artist pages, New Releases (#/new, LB
                fresh releases), Shopping List (#/shopping), "New for You" on Home, Hidden ("Not interested").
  timemachine.js Round 5b: listening history from LB listens (Listens), "On This Day" on Home, Year in review (#/year/Y).
  moments.js    Round 6: Moments: "Right Now" row on Home and the Moments page (#/moments), from time-of-day listening habits.
  sw.js         Service worker: app shell cache, downloaded songs (with Range support) and covers
build/
  mare.sh.in    Installer template (bash). __VERSION__ is replaced. The installer downloads the app from GitHub.
  build.sh      build/build.sh <version>  -> checks the scripts and versions, writes ./mare.sh
test/
  mock_server.py  Mock Navidrome (/rest) + ListenBrainz (/lb/1) + static files, port 8765. User demo / secret
  test_*.py       Playwright browser tests (desktop + mobile, light + dark); screenshots to test-output/
                  (core, discovery, round3 = playlists/downloads/offline, round4 = collection + ratings + player bar,
                  round5 = shopping list + time machine, round6 = Moments; the mock also answers /mb/* like MusicBrainz)
  run.sh          Starts the mock and runs all suites
  fakepve/        Fake pct/pveam/pvesh/pvesm/systemctl to exercise mare.sh without Proxmox
mare.sh         The built installer (~13 KB); this is what the owner's curl command downloads. Commit it with every release.
```

Scripts load in order `app.js` → `discover.js` → `extras.js` → `collection.js` → `shopping.js` → `timemachine.js` → `moments.js`; `boot()` waits for DOMContentLoaded
so every patch is in place before the first render (offline, the ping fails fast enough to race them). Later files use top-level bindings of earlier ones
(`API`, `Player`, `UI`, `View`, `actions`, `store`, `register`, `icon`, `STROKE`, …) and patch them by wrapping
(e.g. `UI.render`, `UI.renderQueue`, `UI.syncPlayer`, `songMenu`, `View.settings`, `API.call`).

## How things work

- **Auth**: Subsonic token auth (`t = md5(password + salt)`), session in localStorage `mare.session`.
  `API.base` is empty when served by the Maré container (same origin; Caddy proxies `/rest/*` to Navidrome).
- **Caddy routes** (written by mare.sh): `/rest/*` → Navidrome (optional BaseUrl rewrite, streaming flush),
  `/lb/*` → `https://api.listenbrainz.org` (prefix stripped, so the browser never needs CORS), `/mb/*` →
  `https://musicbrainz.org/ws/2/*` with a `Mare/<version>` User-Agent (MusicBrainz requires one), everything else → app
  with `index.html` fallback. App shell files (`/`, `*.js`, `*.css`, manifest) are served `Cache-Control: no-cache`.
- **Player** (`app.js`): two `Audio` elements. `tick()` (every 100 ms) preloads the next song into the spare element
  ~40 s before the end, then either schedules a precise gapless switch (`advance(i, 0)`) or starts an equal-power
  crossfade. "Keep albums gapless" disables the fade between songs of the same album. If preloading isn't ready,
  the `ended` event falls back to `load()`, which reuses the preloaded element when it matches.
  Converted streams (Streaming quality ≠ Original) can't be seeked by byte range, so `setSrc` starts them at a position
  with Subsonic `timeOffset` and keeps it in `el._offset`; always use `Player.pos()` / `dur()` / `seek()` rather than
  `audio.currentTime` / `duration`. `transcodes(song)` is false for downloads and for MP3s Navidrome passes through (it
  ignores timeOffset then). `setQuality()` applies a new quality to the playing song at the same position.
  Qualities (`QUALITIES` / `qualitySpec()` in app.js): original, Opus 128 / 96 (Navidrome's `opus` transcoding; sounds
  like MP3 at ~2× the bitrate and has no MP3 encoder gaps), MP3 320 / 192 / 128. Devices that can't play Ogg Opus
  (`CAN_OPUS`, e.g. iOS < 17) get the paired MP3 (Opus 128 → MP3 320, Opus 96 → MP3 192). Downloads use the same specs.
  Volume = user volume × ReplayGain (track/album/auto, peak-limited, never above 1) × fade factor.
  iOS/iPadOS can't set element volume (`Player.volLocked`), so crossfade and levelling are disabled there. Since 1.5.11 those
  devices also use ONE element for everything (`tick()` returns early, `load()` never swaps to the spare): iOS only lets an
  element start without a tap once it has been tapped, so the spare couldn't start the next song.
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
- **Collection (1.4)**: Navidrome reports quality only per song, so `Catalog` reads every song once (`search3` with an
  empty query, 500 per page) into a compact per-album summary in localStorage `mare.catalog` (format, bit depth and
  sample-rate range, bitrate, size, ReplayGain-tagged count, lossy count) plus the user's rated songs. It is rebuilt
  when `getScanStatus.lastScan` changes or after a week; started 4 s after `start()`. Cards get `.qtags` (24/96 FLAC…),
  filled later by `Catalog.paint()` if the catalog wasn't ready. Album pages get a spec sheet computed from the songs.
  "Volume tags" = `replayGain.trackGain/albumGain` present. No "source" line: Navidrome can't know where files came from.
- **Ratings (1.4)**: 1–5 stars via Subsonic `setRating` (0 clears; tapping the current rating clears it) for songs and
  albums, stored in Navidrome. Stars on the album page, at the top of the song menu, in Now Playing, and keys 1–5/0 for
  the playing song; rated songs show ★ in track rows. The player bar shows the playing song's stars and a quality label
  ("FLAC 24/96", or "MP3 320 · from FLAC 24/96") that opens the quality picker (`Quality.pick`).
- **Context menus (1.4.1)**: right-click (or long-press on touch) on songs, queue items, the player bar, chart rows,
  and album/artist/playlist cards opens the same menus as the "…" buttons at the pointer (`contextMenuFor` in
  collection.js); cards use `CardMenus`. Home "Top Rated" row = `getAlbumList2 type=highest` (rated only);
  "Play your 5-star songs" (`mix-top`) uses the catalog's rated songs (5★, or 4★+ when fewer than 10).
- **Shopping list (1.5)**: `MB.get` queues MusicBrainz requests ~1.1 s apart (their rate limit) and retries on 503.
  Artist MBID = Navidrome's `musicBrainzId` (artist or `getArtistInfo2`) or an exact-name MB search (cached 30 days).
  Release groups = `type=album|ep`, minus secondary types (live, compilation, soundtrack, remix…) and future dates,
  cached compactly 7 days. Owned = `sameAlbum()` (normalised names; library title may extend the release title).
  New releases = LB `user/{u}/fresh_releases?days=90&past&future`, owned via `Match.album`. "Hide" stores the id in
  localStorage `mare.hidden`. Covers of missing albums come straight from coverartarchive.org. "Qobuz" links go to
  `qobuz.com/pt-pt/search?q=artist title` (unverified URL format; owner to confirm).
- **Time machine (1.5)**: `Listens.year(y)` pages through LB `user/{u}/listens?max_ts&count=1000` (max_ts and min_ts
  can't be combined) and stores a compact summary per year in localStorage `hist.<y>` (finished years forever, the
  current one for 6 h): plays, durations, every artist (for "new to you" = not in any earlier year), top 60 albums,
  top 100 songs, months, weekdays, busiest day. Years list = LB listening-activity `range=all_time`. On This Day =
  listens of today's date 1–5 years back (`Listens.day`, cached a week). Hours are shown only when ≥ half the listens
  carry a duration ("about"). Names are matched to the library with `Match.album` / `Match.many` / `Match.artist`.
- **Moments (1.5.6)**: `Moments.load()` reads the last 120 days of LB listens (via `Listens.each`) into slots: weekday/weekend
  (`wd`/`we`) × morning 5–11 / afternoon 11–17 / evening 17–22 / night 22–5, each with plays and top artists/albums/songs
  (localStorage `mare.moments`, refreshed after 12 h). A slot needs ≥25 plays to be shown. Home gets a "Right Now" row (top
  of Home, above On This Day; needs ≥3 library albums) and `#/moments` lists every slot (current first, "Now" tag, thin
  slots named in one note). "Play this moment" = the slot's top songs matched to the library, shuffled. `Moments.now` can be
  overridden (tests fake the time). Note `store` prefixes keys with `mare.`.
- **Scan library (1.5.7)**: Settings → Library → "Scan library" calls Subsonic `startScan` (Navidrome may require an admin
  account; code 50 → explained in a toast), follows `getScanStatus` every 1.5 s showing the song count, then busts the API
  cache, re-reads the Catalog (its `lastScan` changed) and re-renders. Reports "N new songs". (`Scan` in collection.js.)
  The Home "Recently Added" shelf (`getAlbumList2 type=newest`) already existed. No downloader: the owner asked for a Qobuz
  downloader (qobuz-dl / SpotiFLAC style); declined on purpose, don't build it.
- **Add to Playlist (1.5.8)**: `Playlists.addTo` reads the chosen playlist (`getPlaylist`) first and adds only songs it doesn't have
  (also drops repeats inside the selection); if nothing is new it says "… is already in <playlist>" and adds nothing.
- **Collection growth (1.5.10)**: the Catalog (now `v: 2`, so it rebuilds once) keeps each album's added month (`a[15]`,
  earliest song `created`, i.e. when Navidrome first saw the files). `Growth.html()` on the Collection page draws an inline-SVG
  running total + monthly bars for albums / songs / storage (chips). A first month holding ≥40% of the albums and ≥3× any
  other month is treated as the starting point (the first scan), not as buying: the chart starts just under it and the note
  says "Started with N … when Navidrome first scanned your library". The owner chose this over ND_RECENTLYADDEDBYMODTIME.
- **Lyrics**: OpenSubsonic `getLyricsBySongId` (synced first), fallback `getLyrics`.
- **Downloads** (`extras.js` + `sw.js`): songs fetched and stored in Cache Storage under `/offline/song/<id>`,
  covers under `/offline/art/<id>`; the service worker serves them (with HTTP Range) for any `/rest/stream?id=`.
  Index in localStorage `mare.downloads`. Needs a secure context (the HTTPS address); not available on plain LAN http.
- **Offline mode**: `API.call` is wrapped; a network failure sets `Offline.offline`, shows a banner, and routing
  falls back to downloaded items / the Downloads page.

## Building and releasing

1. Change files in `app/` (bump `window.MARE_VERSION` in `app.js`, `VERSION` in `sw.js` and the `?v=` on every
   stylesheet/script in `index.html` together; build.sh refuses to build if they disagree). The `?v=` matters: the
   owner's NPMplus may cache .css/.js ("Cache Assets"), which served 1.4's app.css with 1.5's scripts.
2. `build/build.sh <version>` → new `mare.sh`. Since 1.5 the installer doesn't carry the app: it downloads the
   repository tarball (`MARE_SOURCE`, default codeload.github.com/…/tar.gz/refs/heads/main), extracts `app/`
   (fonts included), reads the version from app.js, and only then touches the container; a failed download changes
   nothing. So a release is live once it's merged to main (the raw mare.sh may lag ~5 min behind GitHub's cache).
3. `test/run.sh` (mock server + Playwright). Also worth a run of mare.sh with `test/fakepve` on PATH and a `caddy`
   binary available, then pointing the tests at `MARE_URL=http://127.0.0.1/` to test the installed, minified build.
   Serve a tarball of the working tree for it (`tar czf main.tgz --transform 's,^,Mar--main/,' app …`, then
   `python3 -m http.server`) and set `MARE_SOURCE=http://127.0.0.1:<port>/main.tgz`.
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
- **1.4.0**: Collection: quality labels on album cards, spec sheet per album, Collection page (hi-res / CD / lossy /
  missing volume tags, resolution chart, filters). Star ratings (songs + albums) with Top Rated row, 5-star mix,
  "Top Rated" album sort, rating from Now Playing and keys 1–5. Fix: downloaded albums now open offline on first
  load and when the server is unreachable but the device is online.
- **1.4.1**: player bar: stars for the playing song, quality label + picker (applies to the playing song at the same
  point), fixed-width volume. Right-click / long-press menus everywhere. Seeking while converting no longer restarts the
  song (timeOffset).
- **1.4.2**: Opus 128 / 96 streaming and Opus 128 downloads, with automatic MP3 fallback on devices without Opus.
- **1.5.0**: installer downloads the app from GitHub (mare.sh ~13 KB). Shopping list: New Releases (LB fresh releases,
  in library / not yet), "You have X of Y" + missing albums on artist pages (MusicBrainz), Shopping List page, Hide.
  Time machine: On This Day on Home, Year in review for any year (top artists/albums/songs, months, weekdays, new
  artists). `/mb` Caddy route.
- **1.5.1**: versioned file references (`app.css?v=…`) so a proxy or browser cache can't mix an old stylesheet with
  new scripts (the Your Year page looked broken that way).
- **1.5.2**: Now Playing on phones: the cover keeps the same size and place whatever the title length (the title always
  reserves two lines); stricter width limits on the controls.
- **1.5.3**: Now Playing on wide screens: a very long title no longer pushes the progress/volume bars and title under the Up Next list.
- **1.5.4**: random mid-song skips. A stream cut short (proxy/network) ends "normally" mid-song, so `onEnded` now resumes the song where it stopped if it ends >3 s before its tagged length (up to 3 times, only with progress); `Player.note()` keeps a Playback log (Settings) of why each song changed.
- **1.5.5**: lyrics panel on phones: it reserved 40% of the screen height as bottom padding, which made it taller than its row and spill over the title; now 16vh (empty-state margins smaller too).
- **1.5.6**: Moments (see above): Right Now row on Home, Moments page, "Play this moment".
- **1.5.7**: Scan library button in Settings.
- **1.5.8**: adding songs to a playlist skips ones it already has.
- **1.5.9**: the skips were still happening as an `error` event (code 1, aborted) mid-song, not an early `ended`, so the error
  handler now calls the same `Player.resume()` (reload at the position; ≤3 tries per song, only with progress) before skipping.
  Log entries: "error N, resuming" / "skipped after error".
- **1.5.10**: "Your Collection Over Time" chart on the Collection page.
- **1.5.11**: progress bar froze at 0:00 while playing: `UI.scrubbing` stayed true when a drag ended without a `change` event
  (released where it started / interrupted); now also cleared on pointerup/cancel/touchend/blur. iPhone: next song didn't start
  by itself (second element never tapped) → single element on `volLocked` devices.
- **1.5.12**: AirPods: after an earbud is taken out and put back, iOS resumed the element with no sound. On `volLocked`
  devices a `pause` Maré didn't cause (`ownPause` stamped by toggle/setSrc/next/media-session pause) sets `sysPaused`; the next
  `play` (or media-session play) calls `Player.refresh()` = reload at the same position. Log: "paused by headphones or system" /
  "resumed after headphones".
- **1.5.13**: iPhone Home Screen app sometimes opened with the page shorter than the screen (black band under the tabs, Now
  Playing under the status bar). `--ios-gap` = `screen.height - innerHeight` (standalone, portrait, not typing) extends the tab bar,
  mini player and Now Playing down over it; Now Playing's top padding now respects the safe area.

## Roadmap (agreed with the owner; each needs a plan + go-ahead first)

Part 2, "only Maré does this":
1. ~~New Releases for You~~ (1.5). 2. ~~Complete the Discography~~ (1.5). 3. ~~Time machine~~ (1.5).
4. ~~Moments~~ (1.5.6): Home adapts to time of day/week based on real listening.
5. ~~Album as a story~~: credits, release info, notes, artist profiles done in 1.3; animated covers dropped (none in
   the owner's files).
6. **Maré Connect**: handoff between devices and phone-as-remote (needs a small service in the container).

Open notes: help the owner add ReplayGain tags (rsgain on TrueNAS); real-world check of LB/MusicBrainz matching
quality with Qobuz titles ("Remastered", "Deluxe" etc.) and of the Qobuz search link. The 1.5 features were built
against the documented LB/MB APIs without network access to them (sandbox), so field names should be checked on the
owner's real data first.
