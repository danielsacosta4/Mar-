"use strict";
const norm = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s*[([].*?(remaster|live|version|edit|mix|mono|stereo|deluxe|feat|ft\.|with|bonus|demo|acoustic|instrumental).*?[)\]]/g, "").replace(/\s+-\s+.*(remaster|version|live|edit|mix|mono|stereo).*$/g, "").replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/g, "").replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/^the /, "").trim();
const artistParts = (s) => {
  const whole = norm(s);
  const parts = String(s || "").split(/\s*(?:,|&|\bx\b|\/|;|\bfeat\.?|\bft\.?|\bfeaturing|\bwith|\band)\s*/i).map(norm).filter(Boolean);
  return [.../* @__PURE__ */ new Set([whole, ...parts])];
};
const sameArtist = (a, b) => {
  const A = artistParts(a), B = artistParts(b);
  return A.some((x) => B.includes(x));
};
const LB = {
  cfg() {
    return store.get("lb") || {};
  },
  connected() {
    return !!this.cfg().user;
  },
  hasToken() {
    return !!this.cfg().token;
  },
  base() {
    return API.base ? "https://api.listenbrainz.org" : "/lb";
  },
  async get(path, params = {}, { auth = false, cache = 0, token } = {}) {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v2]) => v2 != null && v2 !== "")).toString();
    const url = "".concat(this.base(), "/1/").concat(path).concat(qs ? "?" + qs : "");
    const key = "lbc." + url;
    if (cache) {
      const hit = store.get(key);
      if (hit && Date.now() - hit.t < cache) return hit.v;
    }
    const headers = { Accept: "application/json" };
    const tk = token || this.cfg().token;
    if ((auth || tk) && tk) headers.Authorization = "Token " + tk;
    let res;
    try {
      res = await fetch(url, { headers });
    } catch {
      throw new ApiError("Can't reach ListenBrainz.", 0);
    }
    if (res.status === 204) {
      if (cache) store.set(key, { t: Date.now(), v: null });
      return null;
    }
    if (res.status === 429) throw new ApiError("ListenBrainz is busy. Try again in a minute.", 429);
    if (res.status === 401) throw new ApiError("ListenBrainz didn't accept your token. Check it in Settings.", 401);
    if (!res.ok) throw new ApiError("ListenBrainz returned ".concat(res.status, "."), res.status);
    const v = await res.json();
    if (cache) store.set(key, { t: Date.now(), v });
    return v;
  },
  async validate(token) {
    const r = await this.get("validate-token", {}, { token });
    if (!r || !r.valid) throw new ApiError("That token isn't valid. Copy it again from ListenBrainz.", 401);
    return r.user_name;
  },
  clearCache() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith("mare.lbc.")).forEach((k) => localStorage.removeItem(k));
    } catch {
    }
  }
};
const HOUR = 60 * MIN;
const jspfTracks = (jspf) => {
  var _a;
  return (((_a = jspf == null ? void 0 : jspf.playlist) == null ? void 0 : _a.track) || []).map((t) => {
    var _a2;
    const ext = ((_a2 = t.extension) == null ? void 0 : _a2["https://musicbrainz.org/doc/jspf#track"]) || {};
    const meta = ext.additional_metadata || {};
    const ident = Array.isArray(t.identifier) ? t.identifier[0] : t.identifier;
    return {
      title: t.title,
      artist: t.creator,
      album: t.album,
      mbid: String(ident || "").split("/").pop(),
      caa: meta.caa_id && meta.caa_release_mbid ? "https://coverartarchive.org/release/".concat(meta.caa_release_mbid, "/").concat(meta.caa_id, "-250.jpg") : ""
    };
  });
};
const playlistMbid = (p) => String(p.identifier || "").split("/").pop();
const Match = {
  mem: /* @__PURE__ */ new Map(),
  key(t) {
    return norm(t.artist) + "|" + norm(t.title);
  },
  async track(t) {
    const k = this.key(t);
    if (this.mem.has(k)) return this.mem.get(k);
    const cached = store.get("m." + k);
    if (cached && Date.now() - cached.t < (cached.id ? 30 : 3) * 24 * HOUR) {
      if (!cached.id) {
        this.mem.set(k, null);
        return null;
      }
      if (Songs.has(cached.id)) {
        this.mem.set(k, Songs.get(cached.id));
        return Songs.get(cached.id);
      }
      const got = await API.call("getSong", { id: cached.id }).then((r) => register([r.song])[0]).catch(() => null);
      if (got) {
        this.mem.set(k, got);
        return got;
      }
    }
    const p = this.find(t).then((s) => {
      store.set("m." + k, { t: Date.now(), id: s ? s.id : null });
      this.mem.set(k, s);
      return s;
    }).catch(() => null);
    this.mem.set(k, p);
    return p;
  },
  async find(t) {
    var _a;
    const want = norm(t.title);
    if (!want) return null;
    const pick = (songs) => songs.find((s) => norm(s.title) === want && (sameArtist(s.artist, t.artist) || sameArtist(s.displayArtist, t.artist))) || songs.find((s) => norm(s.title) === want && (norm(s.artist).includes(norm(t.artist)) || norm(t.artist).includes(norm(s.artist))));
    const clean = (s) => String(s || "").replace(/[([].*?[)\]]/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
    for (const q of ["".concat(clean(t.title), " ").concat(clean(t.artist).split(" ").slice(0, 3).join(" ")), clean(t.title)]) {
      if (!q.trim()) continue;
      const r = await API.call("search3", { query: q, songCount: 25, albumCount: 0, artistCount: 0 }, { cache: 30 * MIN });
      const hit = pick(register(((_a = r.searchResult3) == null ? void 0 : _a.song) || []));
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
        done++;
        onProgress == null ? void 0 : onProgress(done, tracks.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tracks.length) }, worker));
    return out;
  },
  // An album in the library by name + artist (ListenBrainz "releases").
  async album(name, artist) {
    var _a;
    const want = norm(name);
    if (!want) return null;
    const q = String(name).replace(/[([].*?[)\]]/g, " ").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
    const r = await API.call("search3", { query: q || name, albumCount: 20, songCount: 0, artistCount: 0 }, { cache: 30 * MIN });
    const list = ((_a = r.searchResult3) == null ? void 0 : _a.album) || [];
    return list.find((a) => norm(a.name) === want && sameArtist(a.artist, artist)) || list.find((a) => norm(a.name) === want && (norm(a.artist).includes(norm(artist)) || norm(artist).includes(norm(a.artist)))) || null;
  },
  artistsMap: null,
  async artists() {
    var _a;
    if (this.artistsMap) return this.artistsMap;
    const r = await API.call("getArtists", {}, { cache: 10 * MIN });
    const m = /* @__PURE__ */ new Map();
    (((_a = r.artists) == null ? void 0 : _a.index) || []).flatMap((x) => x.artist || []).forEach((a) => {
      if (!m.has(norm(a.name))) m.set(norm(a.name), a);
    });
    this.artistsMap = m;
    setTimeout(() => {
      this.artistsMap = null;
    }, 10 * MIN);
    return m;
  },
  async artist(name) {
    const m = await this.artists();
    for (const p of artistParts(name)) if (m.has(p)) return m.get(p);
    return null;
  }
};
function spread(songs) {
  var _a;
  const pool = songs.slice(), out = [];
  while (pool.length) {
    const last = (_a = out[out.length - 1]) == null ? void 0 : _a.artist;
    let i = pool.findIndex((s) => s.artist !== last);
    if (i < 0) i = 0;
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}
const similarSongs = async (id, count = 40) => {
  var _a;
  const r = await API.call("getSimilarSongs2", { id, count }).catch(() => null);
  return register(((_a = r == null ? void 0 : r.similarSongs2) == null ? void 0 : _a.song) || []);
};
const Radio = {
  state: null,
  label() {
    var _a;
    return ((_a = this.state) == null ? void 0 : _a.label) || "";
  },
  clear() {
    this.state = null;
  },
  async start(kind, seed) {
    const labels = {
      song: () => "".concat(seed.title, " Radio"),
      artist: () => "".concat(seed.name, " Radio"),
      album: () => "".concat(seed.name, " Radio"),
      genre: () => "".concat(seed, " Radio"),
      decade: () => "".concat(seed, "s Radio"),
      station: () => "Your Station",
      lbradio: () => "Recommended Radio"
    };
    const state = { kind, seed, label: labels[kind](), seen: /* @__PURE__ */ new Set(), busy: false, round: 0 };
    toast("Starting ".concat(state.label, "\u2026"));
    let first = await this.fetch(state, true);
    if (!first.length) throw new ApiError("Couldn't find enough music for this radio yet.");
    if (kind === "song") first = [seed, ...first.filter((s) => s.id !== seed.id)];
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
      if (!more.length) {
        st.seen.clear();
        more = (await this.fetch(st, false)).filter((s) => {
          var _a;
          return s.id !== ((_a = Player.current()) == null ? void 0 : _a.id);
        });
      }
      more = spread(shuffleArr(more)).slice(0, 25);
      more.forEach((s) => st.seen.add(s.id));
      if (more.length) Player.addToQueue(more);
    } catch {
    } finally {
      st.busy = false;
    }
  },
  // Returns a batch of library songs for the station.
  async fetch(st, first) {
    var _a;
    st.round++;
    const { kind, seed } = st;
    if (kind === "song") {
      const recent = Player.queue.slice(Math.max(0, Player.index - 4), Player.index + 1);
      const s = first ? seed : recent[Math.floor(Math.random() * recent.length)] || seed;
      let out = await similarSongs(s.id, 40);
      if (out.length < 5) out = out.concat(await this.fallback(s));
      return first ? spread(out) : out;
    }
    if (kind === "artist" || kind === "album") {
      let out = await similarSongs(seed.id, 50);
      if (kind === "artist" && first) {
        const top = await API.call("getTopSongs", { artist: seed.name, count: 5 }).then((r) => {
          var _a2;
          return register(((_a2 = r.topSongs) == null ? void 0 : _a2.song) || []);
        }).catch(() => []);
        out = [...top.slice(0, 3), ...out];
      }
      if (out.length < 5) out = out.concat(await this.fallback(null, seed));
      return spread(out);
    }
    if (kind === "genre") return spread(await randomSongs({ genre: seed, size: 40 }));
    if (kind === "decade") return spread(await randomSongs({ fromYear: seed, toYear: seed + 9, size: 40 }));
    if (kind === "station") {
      if (!st.seeds) st.seeds = shuffleArr(await Discover.topLibraryArtists("quarter", 12));
      if (!st.seeds.length) return spread(await randomSongs({ size: 40 }));
      const picks = [0, 1, 2].map((k) => st.seeds[(st.round * 3 + k) % st.seeds.length]).filter(Boolean);
      const lists = await Promise.all(picks.map((a) => similarSongs(a.id, 15)));
      let out = lists.flat();
      if (out.length < 8) out = out.concat(await randomSongs({ size: 20 }));
      return spread(shuffleArr(out));
    }
    if (kind === "lbradio") {
      const user = LB.cfg().user;
      const prompts = ["recs:".concat(user, "::listened"), "stats:".concat(user, "::month"), "recs:".concat(user)];
      const prompt = prompts[(st.round - 1) % prompts.length];
      let matched = [];
      try {
        const r = await LB.get("explore/lb-radio", { prompt, mode: "easy" }, { auth: true });
        const tracks = jspfTracks((_a = r == null ? void 0 : r.payload) == null ? void 0 : _a.jspf);
        matched = (await Match.many(tracks.slice(0, 40))).filter(Boolean);
      } catch (e) {
        if (first && e.code === 429) toast(e.message);
      }
      if (matched.length < 6) {
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
    const genre = song == null ? void 0 : song.genre;
    if ((song == null ? void 0 : song.artistId) || (artist == null ? void 0 : artist.id)) out.push(...await artistSongs((song == null ? void 0 : song.artistId) || artist.id).catch(() => []));
    if (genre) out.push(...await randomSongs({ genre, size: 30 }).catch(() => []));
    if (!out.length) out.push(...await randomSongs({ size: 30 }));
    return shuffleArr(out).slice(0, 40);
  }
};
const Lyrics = {
  id: null,
  lines: null,
  synced: false,
  active: -1,
  box() {
    return $("#np-lyrics");
  },
  async onSong(s) {
    var _a, _b;
    if (!s) {
      this.id = null;
      this.render();
      return;
    }
    if ($("#np").hidden) {
      this.pending = true;
      return;
    }
    if (this.id === s.id) return;
    this.id = s.id;
    this.lines = null;
    this.synced = false;
    this.active = -1;
    this.box().innerHTML = '<p class="ly-msg">Loading lyrics\u2026</p>';
    const id = s.id;
    let lines = null, synced = false;
    try {
      const r = await API.call("getLyricsBySongId", { id }, { cache: 60 * MIN });
      const list = ((_a = r.lyricsList) == null ? void 0 : _a.structuredLyrics) || [];
      const best = list.find((l) => {
        var _a2;
        return l.synced && ((_a2 = l.line) == null ? void 0 : _a2.length);
      }) || list.find((l) => {
        var _a2;
        return (_a2 = l.line) == null ? void 0 : _a2.length;
      });
      if (best) {
        synced = !!best.synced;
        const off = best.offset || 0;
        lines = best.line.map((l) => {
          var _a2;
          return { t: (((_a2 = l.start) != null ? _a2 : 0) + off) / 1e3, text: l.value || "" };
        });
      }
    } catch {
    }
    if (!lines) {
      try {
        const r = await API.call("getLyrics", { artist: s.artist, title: s.title }, { cache: 60 * MIN });
        const txt = (_b = r.lyrics) == null ? void 0 : _b.value;
        if (txt) lines = txt.split(/\r?\n/).map((text) => ({ t: null, text }));
      } catch {
      }
    }
    if (this.id !== id) return;
    this.lines = lines;
    this.synced = synced;
    this.render();
  },
  render() {
    const box = this.box();
    if (!this.id) {
      box.innerHTML = "";
      return;
    }
    if (!this.lines || !this.lines.some((l) => l.text.trim())) {
      box.innerHTML = '<p class="ly-msg">No lyrics for this song.</p><p class="ly-hint">Mar\xE9 shows lyrics embedded in your files or saved next to them as .lrc files.</p>';
      return;
    }
    box.classList.toggle("synced", this.synced);
    box.innerHTML = '<div class="ly-lines">'.concat(this.lines.map((l, i) => '<p class="ly-line'.concat(l.text.trim() ? "" : " gap", '" data-i="').concat(i, '"').concat(this.synced ? ' data-act="ly-seek" data-t="'.concat(l.t, '"') : "", ">").concat(esc(l.text) || "\u266A", "</p>")).join(""), "</div>");
    this.active = -1;
    this.onTime(Player.pos(), true);
  },
  onTime(t, force) {
    if (!this.synced || !this.lines) return;
    let i = -1;
    for (let k = 0; k < this.lines.length; k++) {
      if (this.lines[k].t <= t + 0.25) i = k;
      else break;
    }
    if (i === this.active && !force) return;
    this.active = i;
    const box = this.box();
    $$(".ly-line", box).forEach((el2, k) => {
      el2.classList.toggle("on", k === i);
      el2.classList.toggle("past", k < i);
    });
    const el = $('.ly-line[data-i="'.concat(i, '"]'), box);
    if (el && !this.userScrolling && box.offsetParent) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight * 0.35, behavior: force ? "auto" : "smooth" });
    }
  }
};
(() => {
  const box = $("#np-lyrics");
  if (!box) return;
  const hold = () => {
    Lyrics.userScrolling = true;
    clearTimeout(Lyrics.t);
    Lyrics.t = setTimeout(() => {
      Lyrics.userScrolling = false;
    }, 4e3);
  };
  box.addEventListener("wheel", hold, { passive: true });
  box.addEventListener("touchmove", hold, { passive: true });
})();
const Discover = {
  async topLibraryArtists(range = "month", want = 18) {
    var _a;
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get("stats/user/".concat(encodeURIComponent(user), "/artists"), { range, count: 60 }, { cache: 6 * HOUR });
    const list = ((_a = r == null ? void 0 : r.payload) == null ? void 0 : _a.artists) || [];
    const out = [], seen = /* @__PURE__ */ new Set();
    for (const a of list) {
      const hit = await Match.artist(a.artist_name);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        out.push(hit);
      }
      if (out.length >= want) break;
    }
    return out;
  },
  async topLibrarySongs(range = "month", want = 10) {
    return (await this.topSongsWithPlays(range, want)).map((x) => x.song);
  },
  // [{ song, plays }]: your most played songs in the range that are in the library.
  async topSongsWithPlays(range = "month", want = 10, count = 40) {
    var _a;
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get("stats/user/".concat(encodeURIComponent(user), "/recordings"), { range, count }, { cache: range.startsWith("this_") ? 2 * HOUR : 6 * HOUR });
    const recs = ((_a = r == null ? void 0 : r.payload) == null ? void 0 : _a.recordings) || [];
    const matched = await Match.many(recs.map((x) => ({ title: x.track_name, artist: x.artist_name })));
    const seen = /* @__PURE__ */ new Set(), out = [];
    matched.forEach((s, i) => {
      if (s && !seen.has(s.id)) {
        seen.add(s.id);
        out.push({ song: s, plays: recs[i].listen_count || 0 });
      }
    });
    return out.slice(0, want);
  },
  // Your week for the Home front page: album of the week, top five songs and a few totals.
  // Tries this week first; early in the week (or before stats update) falls back to last week.
  async weekly() {
    var _a, _b, _c, _d, _e, _f;
    const user = LB.cfg().user;
    if (!user) return null;
    const u = encodeURIComponent(user);
    for (const range of ["this_week", "week"]) {
      const cache = { cache: range === "this_week" ? 2 * HOUR : 6 * HOUR };
      const rel = await LB.get("stats/user/".concat(u, "/releases"), { range, count: 10 }, cache).catch(() => null);
      const releases = ((_a = rel == null ? void 0 : rel.payload) == null ? void 0 : _a.releases) || [];
      if (!releases.length) continue;
      let album = null, albumPlays = 0;
      for (const x of releases.slice(0, 6)) {
        album = await Match.album(x.release_name, x.artist_name).catch(() => null);
        if (album) {
          albumPlays = x.listen_count || 0;
          break;
        }
      }
      const [songs, arts, act] = await Promise.all([
        this.topSongsWithPlays(range, 5, 25).catch(() => []),
        LB.get("stats/user/".concat(u, "/artists"), { range, count: 1 }, cache).catch(() => null),
        LB.get("stats/user/".concat(u, "/listening-activity"), { range }, cache).catch(() => null)
      ]);
      const from = rel.payload.from_ts, to = rel.payload.to_ts;
      const days = (((_b = act == null ? void 0 : act.payload) == null ? void 0 : _b.listening_activity) || []).filter((d) => !from || d.from_ts >= from && d.from_ts < to);
      const listens = days.length ? days.reduce((t, d) => t + (d.listen_count || 0), 0) : null;
      const genres = /* @__PURE__ */ new Map();
      songs.forEach((x) => {
        if (x.song.genre) genres.set(x.song.genre, (genres.get(x.song.genre) || 0) + x.plays + 1);
      });
      const genre = ((_c = [...genres].sort((a, b) => b[1] - a[1])[0]) == null ? void 0 : _c[0]) || (album == null ? void 0 : album.genre) || "";
      return {
        range,
        from,
        to,
        album,
        albumPlays,
        songs,
        listens,
        genre,
        artists: (_e = (_d = arts == null ? void 0 : arts.payload) == null ? void 0 : _d.total_artist_count) != null ? _e : null,
        releases: (_f = rel.payload.total_release_count) != null ? _f : null
      };
    }
    return null;
  },
  async madeForYou() {
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get("user/".concat(encodeURIComponent(user), "/playlists/createdfor"), { count: 30 }, { cache: 3 * HOUR });
    const list = ((r == null ? void 0 : r.playlists) || []).map((x) => x.playlist).filter(Boolean);
    const kind = (p) => {
      var _a, _b, _c;
      const meta = (_c = (_b = (_a = p.extension) == null ? void 0 : _a["https://musicbrainz.org/doc/jspf#playlist"]) == null ? void 0 : _b.additional_metadata) == null ? void 0 : _c.algorithm_metadata;
      return (meta == null ? void 0 : meta.source_patch) || p.title.replace(/\s+(for|of)\s+.*$/i, "").replace(/,.*$/, "").trim();
    };
    const seen = /* @__PURE__ */ new Map();
    list.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    for (const p of list) if (!seen.has(kind(p))) seen.set(kind(p), p);
    return [...seen.values()].slice(0, 6);
  },
  prettyTitle(p) {
    const t = p.title || "Playlist";
    const short = t.replace(/\s+for\s+\S+(\s*,.*|\s+.*)?$/i, "").trim() || t;
    const sub = (t.match(/week of ([\d-]+)/i) || t.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    return { short, sub: sub ? "Week of ".concat(new Date(sub).toLocaleDateString(void 0, { day: "numeric", month: "short" })) : p.date ? new Date(p.date).toLocaleDateString(void 0, { day: "numeric", month: "short" }) : "" };
  },
  async home(box) {
    if (!box) return;
    if (!LB.connected()) {
      box.innerHTML = '<section class="section"><div class="lb-connect">\n        <div><h3>Make Mar\xE9 yours</h3><p>Connect ListenBrainz for your weekly playlists, top songs and a radio that knows your taste.</p></div>\n        <button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div></section>';
      return;
    }
    box.innerHTML = section("Made for You", '<div class="mfy">'.concat('<div class="mfy-card skel"></div>'.repeat(3), "</div>"));
    const route = UI.route;
    const live = () => UI.route === route && document.body.contains(box);
    const [mfy, topArtists] = await Promise.all([
      this.madeForYou().catch(() => []),
      this.topLibraryArtists("month", 18).catch(() => [])
    ]);
    if (!live()) return;
    let html = "";
    if (mfy.length) {
      html += section("Made for You", '<div class="mfy">'.concat(mfy.map((p, i) => {
        const { short, sub } = this.prettyTitle(p);
        return '<a class="mfy-card" href="#/lb/'.concat(esc(playlistMbid(p)), '" style="--hue:').concat([350, 210, 150, 35, 270, 190][i % 6], '">\n          <span class="mfy-kicker">ListenBrainz</span><span class="mfy-title">').concat(esc(short), '</span><span class="mfy-sub">').concat(esc(sub), '</span>\n          <button class="mfy-play" data-act="lb-play" data-id="').concat(esc(playlistMbid(p)), '" aria-label="Play ').concat(esc(short), '">').concat(icon("play"), "</button></a>");
      }).join(""), "</div>"));
    }
    const stations = [
      '<button class="station" data-act="radio-station" style="--hue:350"><span class="st-ico">'.concat(icon("radio"), '</span><span class="st-title">Your Station</span><span class="st-sub">Built from the artists you play most</span></button>')
    ];
    if (LB.hasToken()) stations.push('<button class="station" data-act="radio-lb" style="--hue:200"><span class="st-ico">'.concat(icon("sparkle"), '</span><span class="st-title">Recommended Radio</span><span class="st-sub">ListenBrainz picks, from your library</span></button>'));
    topArtists.slice(0, 6).forEach((a) => stations.push('<button class="station st-artist" data-act="radio-artist" data-id="'.concat(esc(a.id), '">\n        <span class="st-img">').concat(a.coverArt ? '<img loading="lazy" src="'.concat(esc(API.cover(a.coverArt, 200)), '" alt="">') : icon("artist"), '</span>\n        <span class="st-title">').concat(esc(a.name), '</span><span class="st-sub">Artist radio</span></button>')));
    html += section("Radio", '<div class="stations">'.concat(stations.join(""), "</div>"));
    html += '<div id="lb-top-songs"></div>';
    if (topArtists.length >= 3) html += section("Your Top Artists This Month", shelf(topArtists, artistCard));
    box.innerHTML = html;
    this.topLibrarySongs("month", 10).then((songs) => {
      if (!live() || !songs.length) return;
      const id = newList(songs);
      $("#lb-top-songs", box).innerHTML = '<section class="section"><div class="section-head"><h2>On Repeat This Month</h2><a href="#" data-act="play-list" data-list="'.concat(id, '">Play all</a></div>').concat(trackRows(songs, { art: true, numbers: "index" }), "</section>");
      markPlaying();
    }).catch(() => {
    });
  }
};
View.lb = async (main, params, mbid) => {
  main.innerHTML = '<div class="detail lb-detail"><div class="art skel"></div><div></div></div>';
  const r = await LB.get("playlist/".concat(encodeURIComponent(mbid)), {}, { cache: 6 * HOUR });
  if (UI.route.id !== mbid) return;
  const pl = (r == null ? void 0 : r.playlist) || {};
  const tracks = jspfTracks(r);
  const { short, sub } = Discover.prettyTitle(pl);
  const about = (() => {
    const d = document.createElement("div");
    d.innerHTML = pl.annotation || "";
    return d.textContent.trim();
  })();
  main.innerHTML = '<header class="detail lb-detail" style="--tint:'.concat([224, 52, 79].join(","), '">\n      <div class="art mfy-art">').concat(icon("sparkle"), '</div>\n      <div>\n        <div class="detail-kicker">Made for you by ListenBrainz</div>\n        <h1>').concat(esc(short), '</h1>\n        <div class="detail-meta" id="lb-meta">').concat(esc(sub), " \xB7 Matching ").concat(tracks.length, ' songs with your library\u2026</div>\n        <div class="detail-actions">\n          <button class="btn btn-primary" data-act="lb-play" data-id="').concat(esc(mbid), '" disabled>').concat(icon("play"), 'Play</button>\n          <button class="btn" data-act="lb-shuffle" data-id="').concat(esc(mbid), '" disabled>').concat(icon("shuffle"), 'Shuffle</button>\n          <a class="btn btn-link" href="https://listenbrainz.org/playlist/').concat(esc(mbid), '/" target="_blank" rel="noopener">Open in ListenBrainz</a>\n        </div>\n      </div>\n    </header>\n    ').concat(about ? '<p class="bio lb-about">'.concat(esc(about.slice(0, 400)), "</p>") : "", '\n    <div id="lb-have"></div><div id="lb-missing"></div>');
  const matched = await Match.many(tracks, {
    onProgress: (d, t) => {
      const m = $("#lb-meta");
      if (m && UI.route.id === mbid) m.textContent = "".concat(sub ? sub + " \xB7 " : "", "Matching with your library\u2026 ").concat(d, "/").concat(t);
    }
  });
  if (UI.route.id !== mbid) return;
  const have = [], missing = [], seen = /* @__PURE__ */ new Set();
  tracks.forEach((t, i) => {
    const s = matched[i];
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      have.push(s);
    } else if (!s) missing.push(t);
  });
  Discover.cache.set(mbid, have);
  $("#lb-meta").textContent = "".concat(sub ? sub + " \xB7 " : "").concat(have.length, " of ").concat(tracks.length, " songs in your library");
  $$('[data-act="lb-play"], [data-act="lb-shuffle"]', main).forEach((b) => {
    b.disabled = !have.length;
  });
  $("#lb-have").innerHTML = have.length ? trackRows(have, { art: true, numbers: "index" }) : '<div class="empty"><h3>None of these are in your library yet</h3><p>The songs below are what ListenBrainz picked for you.</p></div>';
  if (missing.length) {
    $("#lb-missing").innerHTML = section("Not in Your Library", '<p class="section-note">Songs ListenBrainz recommends that you don\'t have yet.</p>\n      <div class="missing">'.concat(missing.map((t) => '<a class="miss" href="'.concat(t.mbid ? "https://musicbrainz.org/recording/".concat(esc(t.mbid)) : "#", '" target="_blank" rel="noopener">\n        <span class="miss-art">').concat(t.caa ? '<img loading="lazy" src="'.concat(esc(t.caa), '" alt="" onerror="this.remove()">') : "").concat(icon("song"), '</span>\n        <span class="t-main"><span class="t-title">').concat(esc(t.title), '</span><span class="t-sub">').concat(esc(t.artist || ""), "</span></span></a>")).join(""), "</div>"));
  }
  markPlaying();
};
Discover.cache = /* @__PURE__ */ new Map();
async function lbPlaylistSongs(mbid) {
  if (Discover.cache.has(mbid)) return Discover.cache.get(mbid);
  const r = await LB.get("playlist/".concat(encodeURIComponent(mbid)), {}, { cache: 6 * HOUR });
  const songs = (await Match.many(jspfTracks(r))).filter(Boolean);
  const seen = /* @__PURE__ */ new Set();
  const out = songs.filter((s) => !seen.has(s.id) && seen.add(s.id));
  Discover.cache.set(mbid, out);
  return out;
}
View.settings = async (main) => {
  const c = LB.cfg();
  let server = "";
  try {
    const r = await API.call("ping");
    server = "".concat(r.type ? r.type[0].toUpperCase() + r.type.slice(1) : "Server", " ").concat(r.serverVersion || "").trim();
  } catch {
  }
  main.innerHTML = '<h1 class="page-title">Settings</h1>\n    <section class="settings">\n      <div class="set-row"><div><h3>ListenBrainz</h3>\n        <p>'.concat(c.user ? "Connected as <b>".concat(esc(c.user), "</b>").concat(c.token ? "" : " (no token \u2014 Recommended Radio is off)") : "Not connected. Connect it for weekly playlists, top songs and recommendation radio.", '</p></div>\n        <div class="set-actions">').concat(c.user ? '<button class="btn" data-act="lb-connect">Change</button><button class="btn btn-ghost" data-act="lb-disconnect">Disconnect</button>' : '<button class="btn btn-primary" data-act="lb-connect">Connect</button>', '</div></div>\n      <div class="set-row"><div><h3>Navidrome</h3><p>Signed in as <b>').concat(esc(API.user), "</b>").concat(server ? " \xB7 ".concat(esc(server)) : "", '</p></div>\n        <div class="set-actions"><button class="btn btn-ghost" data-act="logout">Sign out</button></div></div>\n      <div class="set-row"><div><h3>Refresh recommendations</h3><p>ListenBrainz data is kept for a few hours. Refresh to load the newest playlists and stats now.</p></div>\n        <div class="set-actions"><button class="btn" data-act="lb-refresh">Refresh</button></div></div>\n      <p class="set-foot">Mar\xE9 ').concat(esc(window.MARE_VERSION || ""), "</p>\n    </section>");
};
function connectSheet() {
  const c = LB.cfg();
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = '<form class="sheet" role="dialog" aria-modal="true" aria-labelledby="lb-h">\n      <h2 id="lb-h">Connect ListenBrainz</h2>\n      <p>Mar\xE9 uses your ListenBrainz history for your weekly playlists, top songs and Recommended Radio. Songs still play from your own library.</p>\n      <label>User token<input name="token" autocomplete="off" spellcheck="false" placeholder="Paste your token" value="'.concat(esc(c.token || ""), '"></label>\n      <p class="sheet-hint">Find it on <a href="https://listenbrainz.org/settings/" target="_blank" rel="noopener">listenbrainz.org \u2192 Settings</a> under \u201CUser token\u201D. It\'s stored only in this browser.</p>\n      <p class="sheet-error" role="alert"></p>\n      <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-close>Not now</button><button class="btn btn-primary" type="submit">Connect</button></div>\n    </form>');
  document.body.appendChild(wrap);
  const f = $("form", wrap);
  const close = () => {
    store.set("lbAsked", true);
    wrap.remove();
  };
  $("[data-close]", wrap).onclick = close;
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const token = f.token.value.trim();
    const btn = $('button[type="submit"]', f);
    if (!token) {
      $(".sheet-error", f).textContent = "Paste your token first.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Checking\u2026";
    try {
      const user = await LB.validate(token);
      store.set("lb", { user, token });
      LB.clearCache();
      close();
      toast("Connected as ".concat(user));
      UI.render();
    } catch (err) {
      $(".sheet-error", f).textContent = err.message;
      btn.disabled = false;
      btn.textContent = "Connect";
    }
  };
  setTimeout(() => f.token.focus(), 30);
}
Object.assign(actions, {
  "lb-connect": () => connectSheet(),
  "lb-disconnect": () => {
    store.del("lb");
    LB.clearCache();
    toast("ListenBrainz disconnected");
    UI.render();
  },
  "lb-refresh": () => {
    LB.clearCache();
    Discover.cache.clear();
    toast("Recommendations refreshed");
    location.hash = "#/home";
  },
  "lb-play": async (el) => Player.playList(await lbPlaylistSongs(el.dataset.id), 0, { shuffle: false }),
  "lb-shuffle": async (el) => Player.playList(await lbPlaylistSongs(el.dataset.id), 0, { shuffle: true }),
  "play-list": (el) => {
    const l = Lists.get(el.dataset.list);
    if (l) Player.playList(l, 0, { shuffle: false });
  },
  "radio-station": () => Radio.start("station", null),
  "radio-lb": () => Radio.start("lbradio", null),
  "radio-artist": async (el) => {
    const r = await API.call("getArtist", { id: el.dataset.id }, { cache: 5 * MIN });
    return Radio.start("artist", r.artist);
  },
  "radio-genre": (el) => Radio.start("genre", el.dataset.id),
  "radio-decade": (el) => Radio.start("decade", +el.dataset.id),
  "ly-seek": (el) => {
    const t = +el.dataset.t;
    if (!Number.isNaN(t)) {
      Player.seek(t);
      if (Player.audio.paused) Player.audio.play().catch(() => {
      });
    }
  }
});
window.Radio = Radio;
window.Lyrics = Lyrics;
window.Discover = Discover;
Discover.onStart = () => {
  if (!LB.connected() && !store.get("lbAsked")) setTimeout(connectSheet, 600);
};
