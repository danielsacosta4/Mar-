/* Maré — Round 2: ListenBrainz discovery, radio and lyrics. Loaded after app.js. */
'use strict';

/* ================= Text matching ================= */

const norm = (s) => String(s || '')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/\s*[([].*?(remaster|live|version|edit|mix|mono|stereo|deluxe|feat|ft\.|with|bonus|demo|acoustic|instrumental).*?[)\]]/g, '')
  .replace(/\s+-\s+.*(remaster|version|live|edit|mix|mono|stereo).*$/g, '')
  .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/g, '')
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .replace(/^the /, '')
  .trim();
// "A & B", "A feat. B", "A, B" -> ["a", "b", "a and b"]
const artistParts = (s) => {
  const whole = norm(s);
  const parts = String(s || '').split(/\s*(?:,|&|\bx\b|\/|;|\bfeat\.?|\bft\.?|\bfeaturing|\bwith|\band)\s*/i).map(norm).filter(Boolean);
  return [...new Set([whole, ...parts])];
};
const sameArtist = (a, b) => {
  const A = artistParts(a), B = artistParts(b);
  return A.some((x) => B.includes(x));
};

/* ================= ListenBrainz client ================= */

const LB = {
  cfg() { return store.get('lb') || {}; },
  connected() { return !!(this.cfg().user); },
  hasToken() { return !!(this.cfg().token); },
  base() { return API.base ? 'https://api.listenbrainz.org' : '/lb'; },

  async get(path, params = {}, { auth = false, cache = 0, token } = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
    const url = `${this.base()}/1/${path}${qs ? '?' + qs : ''}`;
    const key = 'lbc.' + url;
    if (cache) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.t < cache) return hit.v;
    }
    const headers = { Accept: 'application/json' };
    const tk = token || this.cfg().token;
    if ((auth || tk) && tk) headers.Authorization = 'Token ' + tk;
    let res;
    try { res = await fetch(url, { headers }); } catch { throw new ApiError('Can\'t reach ListenBrainz.', 0); }
    if (res.status === 204) { if (cache) store.set(key, { t: Date.now(), v: null }); return null; }
    if (res.status === 429) throw new ApiError('ListenBrainz is busy. Try again in a minute.', 429);
    if (res.status === 401) throw new ApiError('ListenBrainz didn\'t accept your token. Check it in Settings.', 401);
    if (!res.ok) throw new ApiError(`ListenBrainz returned ${res.status}.`, res.status);
    const v = await res.json();
    if (cache) store.set(key, { t: Date.now(), v });
    return v;
  },

  async validate(token) {
    const r = await this.get('validate-token', {}, { token });
    if (!r || !r.valid) throw new ApiError('That token isn\'t valid. Copy it again from ListenBrainz.', 401);
    return r.user_name;
  },

  clearCache() {
    try { Object.keys(localStorage).filter((k) => k.startsWith('mare.lbc.')).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
  },
};

const HOUR = 60 * MIN;

/* JSPF helpers */
const jspfTracks = (jspf) => (jspf?.playlist?.track || []).map((t) => {
  const ext = t.extension?.['https://musicbrainz.org/doc/jspf#track'] || {};
  const meta = ext.additional_metadata || {};
  const ident = Array.isArray(t.identifier) ? t.identifier[0] : t.identifier;
  return {
    title: t.title, artist: t.creator, album: t.album,
    mbid: String(ident || '').split('/').pop(),
    caa: meta.caa_id && meta.caa_release_mbid ? `https://coverartarchive.org/release/${meta.caa_release_mbid}/${meta.caa_id}-250.jpg` : '',
  };
});
const playlistMbid = (p) => String(p.identifier || '').split('/').pop();

/* ================= Library matching ================= */

const Match = {
  mem: new Map(),
  key(t) { return norm(t.artist) + '|' + norm(t.title); },

  async track(t) {
    const k = this.key(t);
    if (this.mem.has(k)) return this.mem.get(k);
    const cached = store.get('m.' + k);
    if (cached && Date.now() - cached.t < (cached.id ? 30 : 3) * 24 * HOUR) {
      if (!cached.id) { this.mem.set(k, null); return null; }
      if (Songs.has(cached.id)) { this.mem.set(k, Songs.get(cached.id)); return Songs.get(cached.id); }
      const got = await API.call('getSong', { id: cached.id }).then((r) => register([r.song])[0]).catch(() => null);
      if (got) { this.mem.set(k, got); return got; }
    }
    const p = this.find(t).then((s) => {
      store.set('m.' + k, { t: Date.now(), id: s ? s.id : null });
      this.mem.set(k, s);
      return s;
    }).catch(() => null);
    this.mem.set(k, p);
    return p;
  },

  async find(t) {
    const want = norm(t.title);
    if (!want) return null;
    const pick = (songs) => songs.find((s) => norm(s.title) === want && (sameArtist(s.artist, t.artist) || sameArtist(s.displayArtist, t.artist)))
      || songs.find((s) => norm(s.title) === want && (norm(s.artist).includes(norm(t.artist)) || norm(t.artist).includes(norm(s.artist))));
    const clean = (s) => String(s || '').replace(/[([].*?[)\]]/g, ' ').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    for (const q of [`${clean(t.title)} ${clean(t.artist).split(' ').slice(0, 3).join(' ')}`, clean(t.title)]) {
      if (!q.trim()) continue;
      const r = await API.call('search3', { query: q, songCount: 25, albumCount: 0, artistCount: 0 }, { cache: 30 * MIN });
      const hit = pick(register(r.searchResult3?.song || []));
      if (hit) return hit;
    }
    return null;
  },

  // Match many with limited concurrency; onProgress(done,total) optional.
  async many(tracks, { limit = 5, onProgress } = {}) {
    const out = new Array(tracks.length).fill(null);
    let i = 0, done = 0;
    const worker = async () => {
      while (i < tracks.length) {
        const n = i++;
        out[n] = await this.track(tracks[n]);
        done++; onProgress?.(done, tracks.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tracks.length) }, worker));
    return out;
  },

  // An album in the library by name + artist (ListenBrainz "releases").
  async album(name, artist) {
    const want = norm(name);
    if (!want) return null;
    const q = String(name).replace(/[([].*?[)\]]/g, ' ').replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
    const r = await API.call('search3', { query: q || name, albumCount: 20, songCount: 0, artistCount: 0 }, { cache: 30 * MIN });
    const list = r.searchResult3?.album || [];
    return list.find((a) => norm(a.name) === want && sameArtist(a.artist, artist))
      || list.find((a) => norm(a.name) === want && (norm(a.artist).includes(norm(artist)) || norm(artist).includes(norm(a.artist))))
      || null;
  },

  artistsMap: null,
  async artists() {
    if (this.artistsMap) return this.artistsMap;
    const r = await API.call('getArtists', {}, { cache: 10 * MIN });
    const m = new Map();
    (r.artists?.index || []).flatMap((x) => x.artist || []).forEach((a) => { if (!m.has(norm(a.name))) m.set(norm(a.name), a); });
    this.artistsMap = m;
    setTimeout(() => { this.artistsMap = null; }, 10 * MIN);
    return m;
  },
  async artist(name) {
    const m = await this.artists();
    for (const p of artistParts(name)) if (m.has(p)) return m.get(p);
    return null;
  },
};

/* ================= Radio ================= */

// Spread songs so the same artist doesn't play twice in a row when avoidable.
function spread(songs) {
  const pool = songs.slice(), out = [];
  while (pool.length) {
    const last = out[out.length - 1]?.artist;
    let i = pool.findIndex((s) => s.artist !== last);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

const similarSongs = async (id, count = 40) => {
  const r = await API.call('getSimilarSongs2', { id, count }).catch(() => null);
  return register(r?.similarSongs2?.song || []);
};

const Radio = {
  state: null,

  label() { return this.state?.label || ''; },
  clear() { this.state = null; },

  async start(kind, seed) {
    const labels = {
      song: () => `${seed.title} Radio`, artist: () => `${seed.name} Radio`, album: () => `${seed.name} Radio`,
      genre: () => `${seed} Radio`, decade: () => `${seed}s Radio`, station: () => 'Your Station', lbradio: () => 'Recommended Radio',
    };
    const state = { kind, seed, label: labels[kind](), seen: new Set(), busy: false, round: 0 };
    toast(`Starting ${state.label}…`);
    let first = await this.fetch(state, true);
    if (!first.length) throw new ApiError('Couldn\'t find enough music for this radio yet.');
    if (kind === 'song') first = [seed, ...first.filter((s) => s.id !== seed.id)];
    first.forEach((s) => state.seen.add(s.id));
    this.state = state;
    Player.playList(first, 0, { shuffle: false, keepRadio: true });
  },

  async maybeRefill() {
    const st = this.state;
    if (!st || st.busy) return;
    if (Player.queue.length - Player.index - 1 > 4) return;
    st.busy = true;
    try {
      let more = [];
      for (let tries = 0; tries < 3 && more.length < 5; tries++) {
        const batch = await this.fetch(st, false);
        more.push(...batch.filter((s) => !st.seen.has(s.id) && !more.some((m) => m.id === s.id)));
      }
      if (this.state !== st) return;
      if (!more.length) {   // library exhausted for this seed: allow repeats rather than stopping
        st.seen.clear();
        more = (await this.fetch(st, false)).filter((s) => s.id !== Player.current()?.id);
      }
      more = spread(shuffleArr(more)).slice(0, 25);
      more.forEach((s) => st.seen.add(s.id));
      if (more.length) Player.addToQueue(more);
    } catch { /* try again on the next song */ } finally { st.busy = false; }
  },

  // Returns a batch of library songs for the station.
  async fetch(st, first) {
    st.round++;
    const { kind, seed } = st;
    if (kind === 'song') {
      // Re-seed from what has played recently, so the radio drifts naturally.
      const recent = Player.queue.slice(Math.max(0, Player.index - 4), Player.index + 1);
      const s = first ? seed : (recent[Math.floor(Math.random() * recent.length)] || seed);
      let out = await similarSongs(s.id, 40);
      if (out.length < 5) out = out.concat(await this.fallback(s));
      return first ? spread(out) : out;
    }
    if (kind === 'artist' || kind === 'album') {
      let out = await similarSongs(seed.id, 50);
      if (kind === 'artist' && first) {
        const top = await API.call('getTopSongs', { artist: seed.name, count: 5 }).then((r) => register(r.topSongs?.song || [])).catch(() => []);
        out = [...top.slice(0, 3), ...out];
      }
      if (out.length < 5) out = out.concat(await this.fallback(null, seed));
      return spread(out);
    }
    if (kind === 'genre') return spread(await randomSongs({ genre: seed, size: 40 }));
    if (kind === 'decade') return spread(await randomSongs({ fromYear: seed, toYear: seed + 9, size: 40 }));
    if (kind === 'station') {
      if (!st.seeds) st.seeds = shuffleArr(await Discover.topLibraryArtists('quarter', 12));
      if (!st.seeds.length) return spread(await randomSongs({ size: 40 }));
      const picks = [0, 1, 2].map((k) => st.seeds[(st.round * 3 + k) % st.seeds.length]).filter(Boolean);
      const lists = await Promise.all(picks.map((a) => similarSongs(a.id, 15)));
      let out = lists.flat();
      if (out.length < 8) out = out.concat(await randomSongs({ size: 20 }));
      return spread(shuffleArr(out));
    }
    if (kind === 'lbradio') {
      const user = LB.cfg().user;
      const prompts = [`recs:${user}::listened`, `stats:${user}::month`, `recs:${user}`];
      const prompt = prompts[(st.round - 1) % prompts.length];
      let matched = [];
      try {
        const r = await LB.get('explore/lb-radio', { prompt, mode: 'easy' }, { auth: true });
        const tracks = jspfTracks(r?.payload?.jspf);
        matched = (await Match.many(tracks.slice(0, 40))).filter(Boolean);
      } catch (e) { if (first && e.code === 429) toast(e.message); }
      if (matched.length < 6) {
        // Not enough of the recommendations are in the library: fill with songs similar to what did match.
        const seeds = matched.length ? matched : (await Discover.topLibrarySongs()).slice(0, 5);
        const extra = (await Promise.all(shuffleArr(seeds).slice(0, 3).map((s) => similarSongs(s.id, 15)))).flat();
        matched = matched.concat(extra);
      }
      return spread(shuffleArr(matched));
    }
    return [];
  },

  // When Navidrome has no similarity data: same artist + same genre.
  async fallback(song, artist) {
    const out = [];
    const genre = song?.genre;
    if (song?.artistId || artist?.id) out.push(...(await artistSongs(song?.artistId || artist.id).catch(() => [])));
    if (genre) out.push(...(await randomSongs({ genre, size: 30 }).catch(() => [])));
    if (!out.length) out.push(...(await randomSongs({ size: 30 })));
    return shuffleArr(out).slice(0, 40);
  },
};

/* ================= Lyrics ================= */

const Lyrics = {
  id: null, lines: null, synced: false, active: -1,

  box() { return $('#np-lyrics'); },

  async onSong(s) {
    if (!s) { this.id = null; this.render(); return; }
    if ($('#np').hidden) { this.pending = true; return; }
    if (this.id === s.id) return;
    this.id = s.id; this.lines = null; this.synced = false; this.active = -1;
    this.box().innerHTML = '<p class="ly-msg">Loading lyrics…</p>';
    const id = s.id;
    let lines = null, synced = false;
    try {
      const r = await API.call('getLyricsBySongId', { id }, { cache: 60 * MIN });
      const list = r.lyricsList?.structuredLyrics || [];
      const best = list.find((l) => l.synced && l.line?.length) || list.find((l) => l.line?.length);
      if (best) {
        synced = !!best.synced;
        const off = best.offset || 0;
        lines = best.line.map((l) => ({ t: ((l.start ?? 0) + off) / 1000, text: l.value || '' }));
      }
    } catch { /* older servers: try the classic endpoint */ }
    if (!lines) {
      try {
        const r = await API.call('getLyrics', { artist: s.artist, title: s.title }, { cache: 60 * MIN });
        const txt = r.lyrics?.value;
        if (txt) lines = txt.split(/\r?\n/).map((text) => ({ t: null, text }));
      } catch { /* none */ }
    }
    if (this.id !== id) return;
    this.lines = lines; this.synced = synced;
    this.render();
  },

  render() {
    const box = this.box();
    if (!this.id) { box.innerHTML = ''; return; }
    if (!this.lines || !this.lines.some((l) => l.text.trim())) {
      box.innerHTML = '<p class="ly-msg">No lyrics for this song.</p><p class="ly-hint">Maré shows lyrics embedded in your files or saved next to them as .lrc files.</p>';
      return;
    }
    box.classList.toggle('synced', this.synced);
    box.innerHTML = `<div class="ly-lines">${this.lines.map((l, i) =>
      `<p class="ly-line${l.text.trim() ? '' : ' gap'}" data-i="${i}"${this.synced ? ` data-act="ly-seek" data-t="${l.t}"` : ''}>${esc(l.text) || '♪'}</p>`).join('')}</div>`;
    this.active = -1;
    this.onTime(Player.pos(), true);
  },

  onTime(t, force) {
    if (!this.synced || !this.lines) return;
    let i = -1;
    for (let k = 0; k < this.lines.length; k++) { if (this.lines[k].t <= t + 0.25) i = k; else break; }
    if (i === this.active && !force) return;
    this.active = i;
    const box = this.box();
    $$('.ly-line', box).forEach((el, k) => { el.classList.toggle('on', k === i); el.classList.toggle('past', k < i); });
    const el = $(`.ly-line[data-i="${i}"]`, box);
    if (el && !this.userScrolling && box.offsetParent) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.35, behavior: force ? 'auto' : 'smooth' });
    }
  },
};
(() => {
  // Let the user scroll lyrics freely; resume auto-scroll a few seconds later.
  const box = $('#np-lyrics');
  if (!box) return;
  const hold = () => { Lyrics.userScrolling = true; clearTimeout(Lyrics.t); Lyrics.t = setTimeout(() => { Lyrics.userScrolling = false; }, 4000); };
  box.addEventListener('wheel', hold, { passive: true });
  box.addEventListener('touchmove', hold, { passive: true });
})();

/* ================= Discover (Home rows, playlists, settings) ================= */

const Discover = {
  async topLibraryArtists(range = 'month', want = 18) {
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get(`stats/user/${encodeURIComponent(user)}/artists`, { range, count: 60 }, { cache: 6 * HOUR });
    const list = r?.payload?.artists || [];
    const out = [], seen = new Set();
    for (const a of list) {
      const hit = await Match.artist(a.artist_name);
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); out.push(hit); }
      if (out.length >= want) break;
    }
    return out;
  },

  async topLibrarySongs(range = 'month', want = 10) {
    return (await this.topSongsWithPlays(range, want)).map((x) => x.song);
  },
  // [{ song, plays }]: your most played songs in the range that are in the library.
  async topSongsWithPlays(range = 'month', want = 10, count = 40) {
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get(`stats/user/${encodeURIComponent(user)}/recordings`, { range, count }, { cache: range.startsWith('this_') ? 2 * HOUR : 6 * HOUR });
    const recs = r?.payload?.recordings || [];
    const matched = await Match.many(recs.map((x) => ({ title: x.track_name, artist: x.artist_name })));
    const seen = new Set(), out = [];
    matched.forEach((s, i) => { if (s && !seen.has(s.id)) { seen.add(s.id); out.push({ song: s, plays: recs[i].listen_count || 0 }); } });
    return out.slice(0, want);
  },

  // Your week for the Home front page: album of the week, top five songs and a few totals.
  // Tries this week first; early in the week (or before stats update) falls back to last week.
  async weekly() {
    const user = LB.cfg().user;
    if (!user) return null;
    const u = encodeURIComponent(user);
    for (const range of ['this_week', 'week']) {
      const cache = { cache: range === 'this_week' ? 2 * HOUR : 6 * HOUR };
      const rel = await LB.get(`stats/user/${u}/releases`, { range, count: 10 }, cache).catch(() => null);
      const releases = rel?.payload?.releases || [];
      if (!releases.length) continue;
      let album = null, albumPlays = 0;
      for (const x of releases.slice(0, 6)) {
        album = await Match.album(x.release_name, x.artist_name).catch(() => null);
        if (album) { albumPlays = x.listen_count || 0; break; }
      }
      const [songs, arts, act] = await Promise.all([
        this.topSongsWithPlays(range, 5, 25).catch(() => []),
        LB.get(`stats/user/${u}/artists`, { range, count: 1 }, cache).catch(() => null),
        LB.get(`stats/user/${u}/listening-activity`, { range }, cache).catch(() => null),
      ]);
      const from = rel.payload.from_ts, to = rel.payload.to_ts;
      // Listening activity also returns the previous period for comparison; count only this one.
      const days = (act?.payload?.listening_activity || []).filter((d) => !from || (d.from_ts >= from && d.from_ts < to));
      const listens = days.length ? days.reduce((t, d) => t + (d.listen_count || 0), 0) : null;
      const genres = new Map();
      songs.forEach((x) => { if (x.song.genre) genres.set(x.song.genre, (genres.get(x.song.genre) || 0) + x.plays + 1); });
      const genre = [...genres].sort((a, b) => b[1] - a[1])[0]?.[0] || album?.genre || '';
      return {
        range, from, to, album, albumPlays, songs, listens, genre,
        artists: arts?.payload?.total_artist_count ?? null,
        releases: rel.payload.total_release_count ?? null,
      };
    }
    return null;
  },

  async madeForYou() {
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get(`user/${encodeURIComponent(user)}/playlists/createdfor`, { count: 30 }, { cache: 3 * HOUR });
    const list = (r?.playlists || []).map((x) => x.playlist).filter(Boolean);
    // Keep the newest playlist of each kind (Weekly Jams, Weekly Exploration, Daily Jams…).
    const kind = (p) => {
      const meta = p.extension?.['https://musicbrainz.org/doc/jspf#playlist']?.additional_metadata?.algorithm_metadata;
      return meta?.source_patch || p.title.replace(/\s+(for|of)\s+.*$/i, '').replace(/,.*$/, '').trim();
    };
    const seen = new Map();
    list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    for (const p of list) if (!seen.has(kind(p))) seen.set(kind(p), p);
    return [...seen.values()].slice(0, 6);
  },

  prettyTitle(p) {
    const t = p.title || 'Playlist';
    const short = t.replace(/\s+for\s+\S+(\s*,.*|\s+.*)?$/i, '').trim() || t;
    const sub = (t.match(/week of ([\d-]+)/i) || t.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    return { short, sub: sub ? `Week of ${new Date(sub).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : (p.date ? new Date(p.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '') };
  },

  async home(box) {
    if (!box) return;
    if (!LB.connected()) {
      box.innerHTML = `<section class="section"><div class="lb-connect">
        <div><h3>Make Maré yours</h3><p>Connect ListenBrainz for your weekly playlists, top songs and a radio that knows your taste.</p></div>
        <button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div></section>`;
      return;
    }
    box.innerHTML = section('Made for You', `<div class="mfy">${'<div class="mfy-card skel"></div>'.repeat(3)}</div>`);
    const route = UI.route;
    const live = () => UI.route === route && document.body.contains(box);

    const [mfy, topArtists] = await Promise.all([
      this.madeForYou().catch(() => []),
      this.topLibraryArtists('month', 18).catch(() => []),
    ]);
    if (!live()) return;

    let html = '';
    if (mfy.length) {
      html += section('Made for You', `<div class="mfy">${mfy.map((p, i) => {
        const { short, sub } = this.prettyTitle(p);
        return `<a class="mfy-card" href="#/lb/${esc(playlistMbid(p))}" style="--hue:${[350, 210, 150, 35, 270, 190][i % 6]}">
          <span class="mfy-kicker">ListenBrainz</span><span class="mfy-title">${esc(short)}</span><span class="mfy-sub">${esc(sub)}</span>
          <button class="mfy-play" data-act="lb-play" data-id="${esc(playlistMbid(p))}" aria-label="Play ${esc(short)}">${icon('play')}</button></a>`;
      }).join('')}</div>`);
    }
    const stations = [
      `<button class="station" data-act="radio-station" style="--hue:350"><span class="st-ico">${icon('radio')}</span><span class="st-title">Your Station</span><span class="st-sub">Built from the artists you play most</span></button>`,
    ];
    if (LB.hasToken()) stations.push(`<button class="station" data-act="radio-lb" style="--hue:200"><span class="st-ico">${icon('sparkle')}</span><span class="st-title">Recommended Radio</span><span class="st-sub">ListenBrainz picks, from your library</span></button>`);
    topArtists.slice(0, 6).forEach((a) => stations.push(`<button class="station st-artist" data-act="radio-artist" data-id="${esc(a.id)}">
        <span class="st-img">${a.coverArt ? `<img loading="lazy" src="${esc(API.cover(a.coverArt, 200))}" alt="">` : icon('artist')}</span>
        <span class="st-title">${esc(a.name)}</span><span class="st-sub">Artist radio</span></button>`));
    html += section('Radio', `<div class="stations">${stations.join('')}</div>`);
    html += '<div id="lb-top-songs"></div>';
    if (topArtists.length >= 3) html += section('Your Top Artists This Month', shelf(topArtists, artistCard));
    box.innerHTML = html;

    this.topLibrarySongs('month', 10).then((songs) => {
      if (!live() || !songs.length) return;
      const id = newList(songs);
      $('#lb-top-songs', box).innerHTML = `<section class="section"><div class="section-head"><h2>On Repeat This Month</h2><a href="#" data-act="play-list" data-list="${id}">Play all</a></div>${trackRows(songs, { art: true, numbers: 'index' })}</section>`;
      markPlaying();
    }).catch(() => {});
  },
};

/* ListenBrainz playlist page */
View.lb = async (main, params, mbid) => {
  main.innerHTML = '<div class="detail lb-detail"><div class="art skel"></div><div></div></div>';
  const r = await LB.get(`playlist/${encodeURIComponent(mbid)}`, {}, { cache: 6 * HOUR });
  if (UI.route.id !== mbid) return;
  const pl = r?.playlist || {};
  const tracks = jspfTracks(r);
  const { short, sub } = Discover.prettyTitle(pl);
  const about = (() => { const d = document.createElement('div'); d.innerHTML = pl.annotation || ''; return d.textContent.trim(); })();
  main.innerHTML = `<header class="detail lb-detail" style="--tint:${[224, 52, 79].join(',')}">
      <div class="art mfy-art">${icon('sparkle')}</div>
      <div>
        <div class="detail-kicker">Made for you by ListenBrainz</div>
        <h1>${esc(short)}</h1>
        <div class="detail-meta" id="lb-meta">${esc(sub)} · Matching ${tracks.length} songs with your library…</div>
        <div class="detail-actions">
          <button class="btn btn-primary" data-act="lb-play" data-id="${esc(mbid)}" disabled>${icon('play')}Play</button>
          <button class="btn" data-act="lb-shuffle" data-id="${esc(mbid)}" disabled>${icon('shuffle')}Shuffle</button>
          <a class="btn btn-link" href="https://listenbrainz.org/playlist/${esc(mbid)}/" target="_blank" rel="noopener">Open in ListenBrainz</a>
        </div>
      </div>
    </header>
    ${about ? `<p class="bio lb-about">${esc(about.slice(0, 400))}</p>` : ''}
    <div id="lb-have"></div><div id="lb-missing"></div>`;
  const matched = await Match.many(tracks, {
    onProgress: (d, t) => { const m = $('#lb-meta'); if (m && UI.route.id === mbid) m.textContent = `${sub ? sub + ' · ' : ''}Matching with your library… ${d}/${t}`; },
  });
  if (UI.route.id !== mbid) return;
  const have = [], missing = [], seen = new Set();
  tracks.forEach((t, i) => { const s = matched[i]; if (s && !seen.has(s.id)) { seen.add(s.id); have.push(s); } else if (!s) missing.push(t); });
  Discover.cache.set(mbid, have);
  $('#lb-meta').textContent = `${sub ? sub + ' · ' : ''}${have.length} of ${tracks.length} songs in your library`;
  $$('[data-act="lb-play"], [data-act="lb-shuffle"]', main).forEach((b) => { b.disabled = !have.length; });
  $('#lb-have').innerHTML = have.length ? trackRows(have, { art: true, numbers: 'index' })
    : '<div class="empty"><h3>None of these are in your library yet</h3><p>The songs below are what ListenBrainz picked for you.</p></div>';
  if (missing.length) {
    $('#lb-missing').innerHTML = section('Not in Your Library', `<p class="section-note">Songs ListenBrainz recommends that you don't have yet.</p>
      <div class="missing">${missing.map((t) => `<a class="miss" href="${t.mbid ? `https://musicbrainz.org/recording/${esc(t.mbid)}` : '#'}" target="_blank" rel="noopener">
        <span class="miss-art">${t.caa ? `<img loading="lazy" src="${esc(t.caa)}" alt="" onerror="this.remove()">` : ''}${icon('song')}</span>
        <span class="t-main"><span class="t-title">${esc(t.title)}</span><span class="t-sub">${esc(t.artist || '')}</span></span></a>`).join('')}</div>`);
  }
  markPlaying();
};
Discover.cache = new Map();

async function lbPlaylistSongs(mbid) {
  if (Discover.cache.has(mbid)) return Discover.cache.get(mbid);
  const r = await LB.get(`playlist/${encodeURIComponent(mbid)}`, {}, { cache: 6 * HOUR });
  const songs = (await Match.many(jspfTracks(r))).filter(Boolean);
  const seen = new Set();
  const out = songs.filter((s) => !seen.has(s.id) && seen.add(s.id));
  Discover.cache.set(mbid, out);
  return out;
}

/* Settings page */
View.settings = async (main) => {
  const c = LB.cfg();
  let server = '';
  try { const r = await API.call('ping'); server = `${r.type ? r.type[0].toUpperCase() + r.type.slice(1) : 'Server'} ${r.serverVersion || ''}`.trim(); } catch { /* ignore */ }
  main.innerHTML = `<h1 class="page-title">Settings</h1>
    <section class="settings">
      <div class="set-row"><div><h3>ListenBrainz</h3>
        <p>${c.user ? `Connected as <b>${esc(c.user)}</b>${c.token ? '' : ' (no token — Recommended Radio is off)'}` : 'Not connected. Connect it for weekly playlists, top songs and recommendation radio.'}</p></div>
        <div class="set-actions">${c.user
          ? '<button class="btn" data-act="lb-connect">Change</button><button class="btn btn-ghost" data-act="lb-disconnect">Disconnect</button>'
          : '<button class="btn btn-primary" data-act="lb-connect">Connect</button>'}</div></div>
      <div class="set-row"><div><h3>Navidrome</h3><p>Signed in as <b>${esc(API.user)}</b>${server ? ` · ${esc(server)}` : ''}</p></div>
        <div class="set-actions"><button class="btn btn-ghost" data-act="logout">Sign out</button></div></div>
      <div class="set-row"><div><h3>Refresh recommendations</h3><p>ListenBrainz data is kept for a few hours. Refresh to load the newest playlists and stats now.</p></div>
        <div class="set-actions"><button class="btn" data-act="lb-refresh">Refresh</button></div></div>
      <p class="set-foot">Maré ${esc(window.MARE_VERSION || '')}</p>
    </section>`;
};

/* Connect sheet */
function connectSheet() {
  const c = LB.cfg();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="lb-h">
      <h2 id="lb-h">Connect ListenBrainz</h2>
      <p>Maré uses your ListenBrainz history for your weekly playlists, top songs and Recommended Radio. Songs still play from your own library.</p>
      <label>User token<input name="token" autocomplete="off" spellcheck="false" placeholder="Paste your token" value="${esc(c.token || '')}"></label>
      <p class="sheet-hint">Find it on <a href="https://listenbrainz.org/settings/" target="_blank" rel="noopener">listenbrainz.org → Settings</a> under “User token”. It's stored only in this browser.</p>
      <p class="sheet-error" role="alert"></p>
      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-close>Not now</button><button class="btn btn-primary" type="submit">Connect</button></div>
    </form>`;
  document.body.appendChild(wrap);
  const f = $('form', wrap);
  const close = () => { store.set('lbAsked', true); wrap.remove(); };
  $('[data-close]', wrap).onclick = close;
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const token = f.token.value.trim();
    const btn = $('button[type="submit"]', f);
    if (!token) { $('.sheet-error', f).textContent = 'Paste your token first.'; return; }
    btn.disabled = true; btn.textContent = 'Checking…';
    try {
      const user = await LB.validate(token);
      store.set('lb', { user, token });
      LB.clearCache();
      close();
      toast(`Connected as ${user}`);
      UI.render();
    } catch (err) {
      $('.sheet-error', f).textContent = err.message;
      btn.disabled = false; btn.textContent = 'Connect';
    }
  };
  setTimeout(() => f.token.focus(), 30);
}

/* ================= Actions ================= */

Object.assign(actions, {
  'lb-connect': () => connectSheet(),
  'lb-disconnect': () => { store.del('lb'); LB.clearCache(); toast('ListenBrainz disconnected'); UI.render(); },
  'lb-refresh': () => { LB.clearCache(); Discover.cache.clear(); toast('Recommendations refreshed'); location.hash = '#/home'; },
  'lb-play': async (el) => Player.playList(await lbPlaylistSongs(el.dataset.id), 0, { shuffle: false }),
  'lb-shuffle': async (el) => Player.playList(await lbPlaylistSongs(el.dataset.id), 0, { shuffle: true }),
  'play-list': (el) => { const l = Lists.get(el.dataset.list); if (l) Player.playList(l, 0, { shuffle: false }); },
  'radio-station': () => Radio.start('station', null),
  'radio-lb': () => Radio.start('lbradio', null),
  'radio-artist': async (el) => {
    const r = await API.call('getArtist', { id: el.dataset.id }, { cache: 5 * MIN });
    return Radio.start('artist', r.artist);
  },
  'radio-genre': (el) => Radio.start('genre', el.dataset.id),
  'radio-decade': (el) => Radio.start('decade', +el.dataset.id),
  'ly-seek': (el) => { const t = +el.dataset.t; if (!Number.isNaN(t)) { Player.seek(t); if (Player.audio.paused) Player.audio.play().catch(() => {}); } },
});

window.Radio = Radio;
window.Lyrics = Lyrics;
window.Discover = Discover;

/* First use: offer to connect ListenBrainz once. */
Discover.onStart = () => {
  if (!LB.connected() && !store.get('lbAsked')) setTimeout(connectSheet, 600);
};
