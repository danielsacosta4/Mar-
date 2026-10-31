"use strict";
const Listens = {
  key: (y) => "hist." + y,
  progress: null,
  async page(maxTs) {
    var _a, _b;
    const user = encodeURIComponent(LB.cfg().user);
    for (let attempt = 0; ; attempt++) {
      try {
        return ((_b = (_a = await LB.get("user/".concat(user, "/listens"), { max_ts: maxTs, count: 1e3 })) == null ? void 0 : _a.payload) == null ? void 0 : _b.listens) || [];
      } catch (e) {
        if (e.code === 429 && attempt < 4) {
          await sleep(1e4);
          continue;
        }
        throw e;
      }
    }
  },
  // All listens between two timestamps, oldest boundary included; onPage(listens) for each page.
  async each(fromTs, toTs, onPage) {
    let max = toTs;
    for (; ; ) {
      const page = await this.page(max);
      const keep = page.filter((l) => l.listened_at >= fromTs && l.listened_at < toTs);
      if (keep.length) onPage(keep);
      if (!page.length) return;
      const oldest = page[page.length - 1].listened_at;
      if (oldest < fromTs || oldest >= max) return;
      max = oldest;
      await sleep(250);
    }
  },
  // Which years have listens (from ListenBrainz's all-time activity), newest first.
  async years() {
    var _a;
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get("stats/user/".concat(encodeURIComponent(user), "/listening-activity"), { range: "all_time" }, { cache: 12 * HOUR }).catch(() => null);
    const ys = (((_a = r == null ? void 0 : r.payload) == null ? void 0 : _a.listening_activity) || []).filter((x) => x.listen_count > 0).map((x) => +String(x.time_range).slice(0, 4)).filter(Boolean);
    const now = (/* @__PURE__ */ new Date()).getFullYear();
    return [...new Set(ys.length ? ys : [now, now - 1])].sort((a, b) => b - a);
  },
  async year(y, onProgress) {
    const now = /* @__PURE__ */ new Date();
    const current = y === now.getFullYear();
    const hit = store.get(this.key(y));
    if (hit && hit.v === 1 && (!current || Date.now() - hit.t < 6 * HOUR)) return hit;
    const from = new Date(y, 0, 1).getTime() / 1e3, to = Math.min(new Date(y + 1, 0, 1).getTime() / 1e3, Math.floor(Date.now() / 1e3) + 1);
    const s = { v: 1, t: Date.now(), year: y, current, plays: 0, durN: 0, durMs: 0, artists: {}, albums: {}, songs: {}, months: Array(12).fill(0), days: Array(7).fill(0), byDay: {} };
    await this.each(from, to, (page) => {
      for (const l of page) {
        const m = l.track_metadata || {}, info = m.additional_info || {};
        const artist = m.artist_name || "", d = new Date(l.listened_at * 1e3);
        s.plays++;
        const ms = info.duration_ms || (info.duration ? info.duration * 1e3 : 0);
        if (ms) {
          s.durN++;
          s.durMs += ms;
        }
        if (artist) s.artists[artist] = (s.artists[artist] || 0) + 1;
        if (m.release_name) {
          const k = artist + "" + m.release_name;
          s.albums[k] = (s.albums[k] || 0) + 1;
        }
        if (m.track_name) {
          const k = artist + "" + m.track_name;
          s.songs[k] = (s.songs[k] || 0) + 1;
        }
        s.months[d.getMonth()]++;
        s.days[d.getDay()]++;
        const day = "".concat(d.getFullYear(), "-").concat(String(d.getMonth() + 1).padStart(2, "0"), "-").concat(String(d.getDate()).padStart(2, "0"));
        s.byDay[day] = (s.byDay[day] || 0) + 1;
      }
      onProgress == null ? void 0 : onProgress(s.plays);
    });
    const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
    s.albums = top(s.albums, 60);
    s.songs = top(s.songs, 100);
    s.busiestDay = Object.entries(s.byDay).sort((a, b) => b[1] - a[1])[0] || null;
    delete s.byDay;
    store.set(this.key(y), s);
    return s;
  },
  // Listens on one calendar day (local time).
  async day(date) {
    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1e3;
    const to = from + 86400;
    const key = "hist.day." + new Date(from * 1e3).toISOString().slice(0, 10);
    const hit = store.get(key);
    if (hit && Date.now() - hit.t < 7 * DAY) return hit.v;
    const out = [];
    await this.each(from, to, (page) => out.push(...page.map((l) => {
      var _a, _b, _c;
      return { a: ((_a = l.track_metadata) == null ? void 0 : _a.artist_name) || "", t: ((_b = l.track_metadata) == null ? void 0 : _b.track_name) || "", r: ((_c = l.track_metadata) == null ? void 0 : _c.release_name) || "" };
    })));
    store.set(key, { t: Date.now(), v: out });
    return out;
  }
};
const splitKey = (k) => {
  const [artist, name] = k.split("");
  return { artist, name };
};
const topOf = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2e3, i, 1).toLocaleDateString(void 0, { month: "short" }));
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2e3, 0, 2 + i).toLocaleDateString(void 0, { weekday: "short" }));
async function matchAlbums(entries, want) {
  const out = [];
  for (const [k, n] of entries) {
    const { artist, name } = splitKey(k);
    const a = await Match.album(name, artist).catch(() => null);
    if (a && !out.some((x) => x.album.id === a.id)) out.push({ album: a, plays: n });
    if (out.length >= want) break;
  }
  return out;
}
const OnThisDay = {
  // The most recent past year (up to 5 back) with listens on today's date.
  async find() {
    const today = /* @__PURE__ */ new Date();
    const years = await Listens.years();
    for (let back = 1; back <= 5; back++) {
      const y = today.getFullYear() - back;
      if (years.length && !years.includes(y)) continue;
      const date = new Date(y, today.getMonth(), today.getDate());
      const listens = await Listens.day(date).catch(() => []);
      if (listens.length) return { date, listens };
    }
    return null;
  }
};
{
  const orig = Discover.home.bind(Discover);
  Discover.home = async (box) => {
    await orig(box);
    if (!LB.connected() || !(box == null ? void 0 : box.isConnected)) return;
    const route = UI.route;
    const hit = await OnThisDay.find().catch(() => null);
    if (!hit || UI.route !== route || !box.isConnected) return;
    const counts = {};
    hit.listens.forEach((l) => {
      if (l.r) {
        const k = l.a + "" + l.r;
        counts[k] = (counts[k] || 0) + 1;
      }
    });
    const albumsThatDay = await matchAlbums(topOf(counts, 12), 8);
    if (UI.route !== route || !box.isConnected) return;
    const when = hit.date.toLocaleDateString(void 0, { day: "numeric", month: "long", year: "numeric" });
    const years = (/* @__PURE__ */ new Date()).getFullYear() - hit.date.getFullYear();
    box.insertAdjacentHTML("afterbegin", '<section class="section on-this-day"><div class="section-head"><h2>On This Day</h2>\n        <span class="head-links"><a href="#" data-act="play-day" data-day="'.concat(hit.date.getTime(), '">Play that day</a><a href="#/year/').concat(hit.date.getFullYear(), '">Your ').concat(hit.date.getFullYear(), '</a></span></div>\n      <p class="section-note">').concat(years === 1 ? "A year ago" : "".concat(years, " years ago"), ", on ").concat(esc(when), ", you played ").concat(plural(hit.listens.length, "song")).concat(albumsThatDay.length ? ". These were the albums:" : ".", "</p>\n      ").concat(albumsThatDay.length ? shelf(albumsThatDay.map((x) => x.album)) : "", "</section>"));
  };
}
View.year = async (main, params, yArg) => {
  if (!LB.connected()) {
    main.innerHTML = '<h1 class="page-title">Your Year</h1><div class="empty"><h3>Connect ListenBrainz</h3><p>Your year in music is built from your ListenBrainz listening history.</p><button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div>';
    return;
  }
  const years = await Listens.years();
  const now = (/* @__PURE__ */ new Date()).getFullYear();
  const y = +yArg || years.find((x) => x < now) || years[0] || now;
  const live = () => UI.route.name === "year" && (+UI.route.id || y) === y;
  const chips = '<div class="chips year-chips">'.concat(years.map((x) => '<a class="chip'.concat(x === y ? " on" : "", '" href="#/year/').concat(x, '">').concat(x, "</a>")).join(""), "</div>");
  main.innerHTML = '<header class="masthead"><h1 class="mast-title cond">'.concat(y, '</h1><div class="mast-issue"><span class="label">Your year in music</span><span class="when" id="year-when">').concat(y === now ? "So far this year" : "", "</span></div></header>\n    ").concat(chips, '<p class="section-note" id="year-progress">Reading your ').concat(y, ' listening history from ListenBrainz\u2026</p><div id="year-body"></div>');
  const earlier = years.filter((x) => x < y).sort((a, b) => a - b);
  const progress = (n) => {
    const el = $("#year-progress");
    if (el) el.textContent = "Reading your ".concat(y, " listening history from ListenBrainz\u2026 ").concat(n.toLocaleString(), " plays so far");
  };
  const s = await Listens.year(y, progress);
  const seenBefore = /* @__PURE__ */ new Set();
  for (const e of earlier) {
    if (!live()) return;
    const p = $("#year-progress");
    if (p && !store.get(Listens.key(e))) p.textContent = "Reading ".concat(e, " too, to find the artists you discovered in ").concat(y, "\u2026");
    const es = await Listens.year(e).catch(() => null);
    if (es) Object.keys(es.artists).forEach((a) => seenBefore.add(norm(a)));
  }
  if (!live()) return;
  if (!s.plays) {
    $("#year-progress").remove();
    $("#year-body").innerHTML = '<div class="empty"><h3>No listens in '.concat(y, "</h3><p>ListenBrainz has nothing for this year.</p></div>");
    return;
  }
  const artistsTop = topOf(s.artists, 10);
  const newArtists = earlier.length ? topOf(s.artists, 9999).filter(([a]) => !seenBefore.has(norm(a))) : [];
  const hours = s.durN >= s.plays * 0.5 ? Math.round(s.durMs / s.durN * s.plays / 36e5) : null;
  const busiestMonth = s.months.indexOf(Math.max(...s.months));
  const busiestDay = s.days.indexOf(Math.max(...s.days));
  $("#year-when").textContent = "".concat(y === now ? "So far: " : "").concat(s.plays.toLocaleString(), " plays").concat(hours != null ? " \xB7 about ".concat(hours.toLocaleString(), " hours") : "");
  $("#year-progress").textContent = "Matching your favourites to your library\u2026";
  const [albumsTop, songsTop] = await Promise.all([
    matchAlbums(topOf(s.albums, 40), 12),
    Match.many(topOf(s.songs, 40).map(([k]) => {
      const { artist, name } = splitKey(k);
      return { artist, title: name };
    })).then((l) => l.filter(Boolean)).catch(() => [])
  ]);
  if (!live()) return;
  $("#year-progress").remove();
  const seen = /* @__PURE__ */ new Set();
  const songs = songsTop.filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 20);
  const hero = albumsTop[0];
  const cell = (n, l) => "<div><b>".concat(esc(n), "</b>").concat(esc(l), "</div>");
  const bars = (vals, labels, hi) => {
    const max = Math.max(1, ...vals);
    return '<div class="vbars">'.concat(vals.map((v, i) => '<div class="vbar'.concat(i === hi ? " hi" : "", '" title="').concat(esc(labels[i]), ": ").concat(v.toLocaleString(), ' plays"><span class="vbar-n">').concat(v ? v.toLocaleString() : "", '</span><i style="height:').concat(v / max * 100, '%"></i><span class="vbar-l">').concat(esc(labels[i]), "</span></div>")).join(""), "</div>");
  };
  const artistRows = await Promise.all(artistsTop.map(async ([name, n], i) => {
    const a = await Match.artist(name).catch(() => null);
    return "<".concat(a ? 'a href="#/artist/'.concat(esc(a.id), '"') : "div", ' class="chart-row"><span class="chart-no">').concat(i + 1, "</span>\n      ").concat((a == null ? void 0 : a.coverArt) ? '<img loading="lazy" src="'.concat(esc(API.cover(a.coverArt, 120)), '" alt="">') : '<span class="ph"></span>', '\n      <span><span class="chart-title">').concat(esc(name), '</span><span class="chart-sub">').concat(plural(n, "play"), "</span></span></").concat(a ? "a" : "div", ">");
  }));
  if (!live()) return;
  const songsList = songs.length ? newList(songs) : null;
  $("#year-body").innerHTML = '\n    <section class="front">\n      <div class="feature">\n        '.concat(hero ? '<a class="art" href="#/album/'.concat(esc(hero.album.id), '">').concat(artImg(hero.album.coverArt, 600, hero.album.name), "</a>") : "<div></div>", '\n        <div class="feature-text">\n          <span class="label">').concat(hero ? "Your album of ".concat(y) : "Your year", "</span>\n          ").concat(hero ? '<h2 class="feature-title cond"><a href="#/album/'.concat(esc(hero.album.id), '">').concat(esc(hero.album.name), '</a></h2>\n          <span class="feature-by">').concat(esc(hero.album.artist || ""), '</span>\n          <p class="feature-quote">You played it ').concat(plural(hero.plays, "time")).concat(y === now ? " so far this year" : " in ".concat(y), '.</p>\n          <button class="btn btn-primary" data-act="play-album" data-id="').concat(esc(hero.album.id), '">').concat(icon("play"), "Play the album</button>") : "", '\n        </div>\n        <div class="feature-strip">').concat([
    cell(s.plays.toLocaleString(), "plays"),
    hours != null ? cell(hours.toLocaleString(), "hours, about") : cell(Object.keys(s.albums).length >= 60 ? "60+" : String(Object.keys(s.albums).length), "albums"),
    cell(Object.keys(s.artists).length.toLocaleString(), "artists"),
    earlier.length ? cell(newArtists.length.toLocaleString(), "new to you") : cell(MONTHS[busiestMonth], "busiest month")
  ].join(""), '</div>\n      </div>\n      <div class="chart"><span class="label">Your top artists</span>').concat(artistRows.slice(0, 5).join(""), "</div>\n    </section>\n    ").concat(songs.length ? '<section class="section"><div class="section-head"><h2>Your Top Songs</h2><a href="#" data-act="play-list" data-list="'.concat(songsList, '">Play your ').concat(y, "</a></div>").concat(trackRows(songs.slice(0, 10), { art: true, numbers: "index" }), "</section>") : "", "\n    ").concat(albumsTop.length ? section("Your Top Albums", '<div class="grid">'.concat(albumsTop.map((x) => albumCard(x.album).replace('<div class="card-title">', '<div class="card-when">'.concat(plural(x.plays, "play"), '</div><div class="card-title">'))).join(""), "</div>")) : "", "\n    ").concat(artistRows.length > 5 ? section("More Top Artists", '<div class="chart chart-wide">'.concat(artistRows.slice(5).join(""), "</div>")) : "", "\n    ").concat(section("Month by Month", '<p class="section-note">Your busiest month was '.concat(esc(new Date(2e3, busiestMonth, 1).toLocaleDateString(void 0, { month: "long" }))).concat(s.busiestDay ? ", and your busiest day ".concat(esc((/* @__PURE__ */ new Date(s.busiestDay[0] + "T12:00:00")).toLocaleDateString(void 0, { day: "numeric", month: "long" })), " (").concat(plural(s.busiestDay[1], "play"), ")") : "", ".</p>").concat(bars(s.months, MONTHS, busiestMonth))), "\n    ").concat(section("Day by Day", '<p class="section-note">You listen most on '.concat(esc(new Date(2e3, 0, 2 + busiestDay).toLocaleDateString(void 0, { weekday: "long" })), "s.</p>").concat(bars(s.days, WEEKDAYS, busiestDay))), "\n    ").concat(newArtists.length ? section("New to You", '<p class="section-note">'.concat(plural(newArtists.length, "artist"), " you first listened to in ").concat(y, '. The ones you played most:</p>\n      <div class="chips">').concat(newArtists.slice(0, 24).map(([a, n]) => '<span class="chip">'.concat(esc(a), " \xB7 ").concat(n, "</span>")).join(""), "</div>")) : "");
  applyTint($(".feature", main), hero ? API.cover(hero.album.coverArt, 300) : "");
  markPlaying();
};
Object.assign(actions, {
  "play-day": async (el) => {
    const listens = await Listens.day(/* @__PURE__ */ new Date(+el.dataset.day));
    const uniq = [], seen = /* @__PURE__ */ new Set();
    for (const l of listens) {
      const k = norm(l.a) + "|" + norm(l.t);
      if (l.t && !seen.has(k)) {
        seen.add(k);
        uniq.push({ artist: l.a, title: l.t });
      }
    }
    toast("Finding that day's songs in your library\u2026");
    const songs = (await Match.many(uniq.slice(0, 60))).filter(Boolean);
    if (songs.length) Player.playList(songs, 0, { shuffle: false });
    else toast("None of that day's songs are in your library");
  }
});
{
  STROKE.calendar = '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  const nav = $(".side-nav");
  const after = $('[data-nav="shopping"]', nav);
  if (after && !$('[data-nav="year"]', nav)) after.insertAdjacentHTML("afterend", '<a href="#/year" data-nav="year"><span class="ico">'.concat(icon("calendar"), "</span>Your Year</a>"));
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const s = $('.lib-links [href="#/shopping"]', main);
    if (s && !$('.lib-links [href="#/year"]', main)) s.insertAdjacentHTML("afterend", '<a href="#/year"><span class="ico">'.concat(icon("calendar"), "</span>Your Year</a>"));
    return p;
  };
}
window.Listens = Listens;
