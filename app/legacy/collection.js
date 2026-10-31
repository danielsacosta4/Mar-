"use strict";
Object.assign(STROKE, {
  star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.6l6.1-.8z"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
});
FILL.starFill = '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.6l6.1-.8z"/>';
const khz = (hz) => +(hz / 1e3).toFixed(1);
const fmtSize = (bytes) => {
  if (!bytes) return "";
  const gb = bytes / 1e9;
  return gb >= 1 ? "".concat(gb.toFixed(gb >= 100 ? 0 : 1), " GB") : "".concat(Math.round(bytes / 1e6), " MB");
};
const hasGain = (s) => !!s.replayGain && (s.replayGain.trackGain != null || s.replayGain.albumGain != null);
const isLossless = (s) => {
  var _a;
  return ((_a = qualityOf(s)) == null ? void 0 : _a.cls) !== "lossy";
};
const RATED_KEEP = [
  "id",
  "title",
  "artist",
  "artistId",
  "album",
  "albumId",
  "coverArt",
  "duration",
  "track",
  "discNumber",
  "year",
  "genre",
  "suffix",
  "bitRate",
  "bitDepth",
  "samplingRate",
  "replayGain",
  "starred",
  "userRating",
  "musicBrainzId"
];
const Catalog = {
  data: null,
  building: null,
  progress: null,
  // { done, total } while reading
  load() {
    if (!this.data) {
      const d = store.get("catalog");
      this.data = d && d.v === 2 ? d : null;
    }
    return this.data;
  },
  save() {
    store.set("catalog", this.data);
  },
  album(id) {
    var _a;
    return ((_a = this.load()) == null ? void 0 : _a.albums[id]) || null;
  },
  // Read again when Navidrome's last scan changed, or once a week.
  async ensure() {
    if (this.building) return this.building;
    const st = await API.call("getScanStatus").then((r) => r.scanStatus || {}).catch(() => null);
    const d = this.load();
    if (st == null ? void 0 : st.scanning) return d;
    const stale = !d || st && st.lastScan && st.lastScan !== d.scan || Date.now() - d.at > 7 * 24 * HOUR;
    return stale ? this.build(st) : d;
  },
  build(st) {
    this.building = (async () => {
      var _a, _b, _c;
      const albums = {}, rated = [];
      const size = 500;
      let offset = 0, total = 0;
      this.progress = { done: 0, total: (st == null ? void 0 : st.count) || 0 };
      (_a = UI.collectionTick) == null ? void 0 : _a.call(UI);
      for (; ; ) {
        const r = await API.call("search3", { query: "", songCount: size, songOffset: offset, albumCount: 0, artistCount: 0 });
        const songs = ((_b = r.searchResult3) == null ? void 0 : _b.song) || [];
        for (const s of songs) {
          if (!s.albumId) continue;
          const a = albums[s.albumId] || (albums[s.albumId] = [s.album || "", s.displayAlbumArtist || s.artist || "", s.coverArt || s.albumId, "", 99, 0, 1e9, 0, 0, 0, 0, 0, 0, 0, 0, ""]);
          const fmt = String(s.suffix || "").toUpperCase();
          if (fmt && !a[3].split("/").includes(fmt)) a[3] = a[3] ? a[3] + "/" + fmt : fmt;
          if (s.bitDepth) {
            a[4] = Math.min(a[4], s.bitDepth);
            a[5] = Math.max(a[5], s.bitDepth);
          }
          if (s.samplingRate) {
            a[6] = Math.min(a[6], s.samplingRate);
            a[7] = Math.max(a[7], s.samplingRate);
          }
          const sec = s.duration || 0;
          a[8] += (s.bitRate || 0) * sec;
          a[9] += sec;
          a[10] += s.size || 0;
          a[11]++;
          if (s.created) {
            const m = String(s.created).slice(0, 7);
            if (!a[15] || m < a[15]) a[15] = m;
          }
          if (hasGain(s)) a[12]++;
          if (!isLossless(s)) a[13]++;
          if (s.userRating) rated.push(Object.fromEntries(RATED_KEEP.filter((k) => s[k] != null).map((k) => [k, s[k]])));
        }
        total += songs.length;
        offset += songs.length;
        this.progress = { done: total, total: Math.max(total, (st == null ? void 0 : st.count) || 0) };
        (_c = UI.collectionTick) == null ? void 0 : _c.call(UI);
        if (songs.length < size) break;
      }
      for (const a of Object.values(albums)) {
        if (a[4] === 99) a[4] = 0;
        if (a[6] === 1e9) a[6] = 0;
      }
      this.data = { v: 2, at: Date.now(), scan: (st == null ? void 0 : st.lastScan) || "", songs: total, albums, rated };
      this.save();
      return this.data;
    })().finally(() => {
      var _a;
      this.building = null;
      this.progress = null;
      this.paint();
      (_a = UI.collectionTick) == null ? void 0 : _a.call(UI);
    });
    return this.building;
  },
  // What a card shows: "24/96" + "FLAC", or "320k" + "MP3".
  label(id) {
    const a = this.album(id);
    if (!a || !a[11]) return null;
    const lossy = a[13] === a[11];
    const fmt = a[3].split("/")[0] || "";
    if (lossy) return { res: a[9] ? "".concat(Math.round(a[8] / a[9]), "k") : "", fmt, cls: "lossy" };
    const hires = a[5] > 16 || a[7] > 48e3;
    const res = a[5] && a[7] ? "".concat(a[5], "/").concat(khz(a[7])) : a[7] ? "".concat(khz(a[7]), " kHz") : "";
    return { res, fmt, cls: hires ? "hires" : "lossless" };
  },
  tags(id) {
    const l = this.label(id);
    return l ? "".concat(l.res ? '<span class="qtag '.concat(l.cls, '">').concat(esc(l.res), "</span>") : "").concat(l.fmt ? '<span class="qtag">'.concat(esc(l.fmt), "</span>") : "") : "";
  },
  // Fill the labels under cards that were drawn before the catalog was ready.
  paint(root = document) {
    if (!this.load()) return;
    $$(".qtags[data-qa]:empty", root).forEach((el) => {
      el.innerHTML = this.tags(el.dataset.qa);
    });
  },
  // Buckets for the Collection page (by each album's best resolution).
  bucket(a) {
    if (a[13] === a[11]) return "lossy";
    if (a[7] > 96e3) return "b192";
    if (a[7] > 48e3) return "b96";
    if (a[5] > 16) return "b48";
    return "cd";
  },
  setRating(song, n) {
    const d = this.load();
    if (!d) return;
    d.rated = d.rated.filter((x) => x.id !== song.id);
    if (n) d.rated.push({ ...Object.fromEntries(RATED_KEEP.filter((k) => song[k] != null).map((k) => [k, song[k]])), userRating: n });
    this.save();
  }
};
const qtagsHtml = (id) => '<div class="qtags" data-qa="'.concat(esc(id), '">').concat(Catalog.load() ? Catalog.tags(id) : "", "</div>");
albumCard = /* @__PURE__ */ ((orig) => function(a) {
  return orig(a).replace(/<\/a>\s*$/, "".concat(qtagsHtml(a.id), "</a>"));
})(albumCard);
discCard = /* @__PURE__ */ ((orig) => function(a) {
  return orig(a).replace(/<\/a>\s*$/, "".concat(qtagsHtml(a.id), "</a>"));
})(discCard);
function specSheet(songs) {
  if (!songs.length) return "";
  const rows = [];
  const fmts = [...new Set(songs.map((s) => {
    var _a;
    return ((_a = qualityOf(s)) == null ? void 0 : _a.cls) === "lossless" && String(s.suffix).toLowerCase() === "m4a" ? "ALAC" : String(s.suffix || "").toUpperCase();
  }).filter(Boolean))];
  if (fmts.length) rows.push(["Format", fmts.join(", ")]);
  const ds = songs.map((s) => s.bitDepth).filter(Boolean), rs = songs.map((s) => s.samplingRate).filter(Boolean);
  const range = (arr, f) => {
    const lo = Math.min(...arr), hi = Math.max(...arr);
    return lo === hi ? f(lo) : "".concat(f(lo), "\u2013").concat(f(hi));
  };
  if (ds.length || rs.length) rows.push(["Resolution", [ds.length && range(ds, (v) => v) + "-bit", rs.length && range(rs, khz) + " kHz"].filter(Boolean).join(" / ")]);
  const secs = songs.reduce((t, s) => t + (s.bitRate ? s.duration || 0 : 0), 0);
  if (secs) rows.push(["Bitrate", "".concat(Math.round(songs.reduce((t, s) => t + (s.bitRate || 0) * (s.duration || 0), 0) / secs).toLocaleString(), " kbps average")]);
  const bytes = songs.reduce((t, s) => t + (s.size || 0), 0);
  if (bytes) rows.push(["Size", fmtSize(bytes)]);
  const tagged = songs.filter(hasGain).length;
  rows.push(["Volume tags", tagged === songs.length ? "Tagged" : tagged ? "Partly tagged (".concat(tagged, " of ").concat(songs.length, ")") : "Not tagged", tagged < songs.length]);
  const spec = qualitySpec(Prefs.get("quality"));
  const conv = spec && songs.some((s) => Player.transcodes(s));
  rows.push(["You hear", conv ? "Converted to ".concat(specName(spec), " kbps (streaming setting)") : "The original files, untouched"]);
  return '<section class="spec"><div class="label">Your copy</div><dl>'.concat(rows.map(([k, v, warn]) => "<div><dt>".concat(esc(k), "</dt><dd").concat(warn ? ' class="warn"' : "", ">").concat(esc(v), "</dd></div>")).join(""), "</dl></section>");
}
const Rating = {
  stars(n, attrs) {
    return '<span class="stars" role="group" aria-label="Rating" '.concat(attrs, ">").concat([1, 2, 3, 4, 5].map((k) => '<button class="star'.concat(k <= n ? " on" : "", '" data-act="rate" data-n="').concat(k, '" aria-label="').concat(k, " star").concat(k > 1 ? "s" : "", '">').concat(icon(k <= n ? "starFill" : "star"), "</button>")).join(""), "</span>");
  },
  text: (n) => n ? "\u2605".repeat(n) : "",
  async set(kind, id, n) {
    var _a;
    await API.call("setRating", { id, rating: n });
    API.bust();
    if (kind === "song") {
      const s = Songs.get(id);
      if (s) {
        s.userRating = n || void 0;
        Catalog.setRating(s, n);
      }
      $$('.track[data-song="'.concat(CSS.escape(id), '"] .t-rating')).forEach((el) => {
        el.textContent = Rating.text(n);
      });
    }
    $$('.stars[data-kind="'.concat(kind, '"][data-id="').concat(CSS.escape(id), '"]')).forEach((el) => {
      el.outerHTML = Rating.stars(n, 'data-kind="'.concat(kind, '" data-id="').concat(esc(id), '"'));
    });
    if (kind === "song" && ((_a = Player.current()) == null ? void 0 : _a.id) === id) Rating.syncNP();
    toast(n ? "Rated ".concat("\u2605".repeat(n)) : "Rating removed");
  },
  // Stars for the playing song: under the title in Now Playing and in the player bar.
  syncNP() {
    var _a;
    const s = Player.current();
    if (!$(".np-rate")) (_a = $(".np-text")) == null ? void 0 : _a.insertAdjacentHTML("beforeend", '<div class="np-rate"></div>');
    const key = s ? "".concat(s.id, ":").concat(s.userRating || 0) : "";
    $$(".np-rate, .p-rate").forEach((box) => {
      if (box.dataset.key === key) return;
      box.dataset.key = key;
      box.innerHTML = s ? Rating.stars(s.userRating || 0, 'data-kind="song" data-id="'.concat(esc(s.id), '"')) : "";
    });
  }
};
Object.assign(actions, {
  rate: (el) => {
    const box = el.closest(".stars");
    const n = +el.dataset.n;
    const cur = box.querySelectorAll(".star.on").length;
    Menu.close();
    return Rating.set(box.dataset.kind, box.dataset.id, n === cur ? 0 : n);
  },
  "mix-top": async () => {
    const d = await Catalog.ensure();
    const rated = ((d == null ? void 0 : d.rated) || []).slice();
    const best = rated.filter((s) => s.userRating === 5);
    const list = best.length >= 10 ? best : rated.filter((s) => s.userRating >= 4);
    if (!list.length) {
      toast("Rate some songs with 4 or 5 stars first");
      return;
    }
    Player.playList(list, 0, { shuffle: true });
  }
});
{
  const prev = songMenu;
  songMenu = function(anchor, s) {
    prev(anchor, s);
    $("#menu").insertAdjacentHTML("afterbegin", '<div class="menu-stars">'.concat(Rating.stars(s.userRating || 0, 'data-kind="song" data-id="'.concat(esc(s.id), '"')), "</div><hr>"));
  };
}
{
  const sync = UI.syncPlayer.bind(UI);
  UI.syncPlayer = function() {
    sync();
    Rating.syncNP();
  };
}
document.addEventListener("keydown", (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = Player.current();
  if (!s || !/^[0-5]$/.test(e.key)) return;
  run(() => Rating.set("song", s.id, +e.key));
});
function menuAt(x, y) {
  const m = $("#menu");
  if (m.hidden) return;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + "px";
}
const starsRow = (kind, id, n) => '<div class="menu-stars">'.concat(Rating.stars(n, 'data-kind="'.concat(kind, '" data-id="').concat(esc(id), '"')), "</div><hr>");
const CardMenus = {
  async album(el, id) {
    const songs = () => albumSongs(id).then((x) => x.songs);
    Menu.open(el, [
      { key: "play", label: "Play", icon: "play", run: async () => Player.playList(await songs(), 0, { shuffle: false }) },
      { key: "shuffle", label: "Shuffle", icon: "shuffle", run: async () => Player.playList(await songs(), 0, { shuffle: true }) },
      "-",
      { key: "next", label: "Play Next", icon: "playNext", run: async () => {
        Player.playNext(await songs());
        toast("Album plays next");
      } },
      { key: "queue", label: "Add to Queue", icon: "addQueue", run: async () => {
        Player.addToQueue(await songs());
        toast("Album added to queue");
      } },
      { key: "radio", label: "Start Radio", icon: "radio", run: async () => window.Radio.start("album", (await albumSongs(id)).album) },
      { key: "addpl", label: "Add to Playlist\u2026", icon: "playlist", run: async () => Playlists.addTo(await songs()) },
      "-",
      { key: "dl", label: Offline.has("album:" + id) ? "Downloaded" : "Download", icon: "download", run: () => Offline.has("album:" + id) ? toast("Already downloaded") : Offline.download("album", id) },
      { key: "open", label: "Go to Album", icon: "album", run: () => {
        location.hash = "#/album/" + id;
      } }
    ]);
    $("#menu").insertAdjacentHTML("afterbegin", starsRow("album", id, 0));
    const a = await albumSongs(id).then((x) => x.album).catch(() => null);
    const box = $("#menu .menu-stars");
    if (a && box && !$("#menu").hidden) box.innerHTML = Rating.stars(a.userRating || 0, 'data-kind="album" data-id="'.concat(esc(id), '"'));
  },
  artist(el, id) {
    Menu.open(el, [
      { key: "shuffle", label: "Shuffle", icon: "shuffle", run: () => actions["play-artist"]({ dataset: { id } }) },
      { key: "radio", label: "Start Radio", icon: "radio", run: () => actions["radio-artist"]({ dataset: { id } }) },
      { key: "open", label: "Go to Artist", icon: "artist", run: () => {
        location.hash = "#/artist/" + id;
      } }
    ]);
  },
  playlist(el, id) {
    Menu.open(el, [
      { key: "play", label: "Play", icon: "play", run: () => actions["play-playlist"]({ dataset: { id } }) },
      { key: "shuffle", label: "Shuffle", icon: "shuffle", run: () => actions["shuffle-playlist"]({ dataset: { id } }) },
      { key: "queue", label: "Add to Queue", icon: "addQueue", run: async () => {
        Player.addToQueue(await playlistSongs(id));
        toast("Playlist added to queue");
      } },
      { key: "dl", label: Offline.has("playlist:" + id) ? "Downloaded" : "Download", icon: "download", run: () => Offline.has("playlist:" + id) ? toast("Already downloaded") : Offline.download("playlist", id) },
      { key: "open", label: "Open Playlist", icon: "playlist", run: () => {
        location.hash = "#/playlist/" + id;
      } }
    ]);
  }
};
function contextMenuFor(target, x, y) {
  let el;
  if (el = target.closest(".track")) {
    const more = $(".t-more", el);
    if (!more) return false;
    actions["menu-song"](more);
  } else if (el = target.closest(".q-item")) {
    const s = Player.queue[+el.dataset.i];
    if (!s) return false;
    songMenu(el, s);
  } else if (el = target.closest(".p-now, .np-meta")) {
    if (!Player.current()) return false;
    actions["menu-current"](el);
  } else if (el = target.closest(".chart-row[data-song]")) {
    const s = Songs.get(el.dataset.song);
    if (!s) return false;
    songMenu(el, s);
  } else if (el = target.closest('a[href^="#/album/"]:is(.card, .chart-row, .art, .top-result)')) {
    CardMenus.album(el, decodeURIComponent(el.getAttribute("href").split("/")[2]));
  } else if (el = target.closest('a.card[href^="#/artist/"]')) {
    CardMenus.artist(el, decodeURIComponent(el.getAttribute("href").split("/")[2]));
  } else if (el = target.closest('a.card[href^="#/playlist/"]')) {
    CardMenus.playlist(el, decodeURIComponent(el.getAttribute("href").split("/")[2]));
  } else return false;
  menuAt(x, y);
  return true;
}
document.addEventListener("contextmenu", (e) => {
  if (e.target.closest("input, textarea, #menu")) return;
  if (contextMenuFor(e.target, e.clientX, e.clientY)) e.preventDefault();
});
{
  let timer = null, start = null, fired = false;
  document.addEventListener("touchstart", (e) => {
    var _a, _b;
    if (e.touches.length !== 1 || ((_b = (_a = e.target).closest) == null ? void 0 : _b.call(_a, ".grip, .scrubber"))) return;
    const t = e.touches[0];
    start = { x: t.clientX, y: t.clientY, target: e.target };
    fired = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!start) return;
      fired = contextMenuFor(start.target, start.x, start.y);
      if (fired && navigator.vibrate) navigator.vibrate(10);
    }, 520);
  }, { passive: true });
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  document.addEventListener("touchmove", (e) => {
    const t = e.touches[0];
    if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    cancel();
    if (fired) {
      e.preventDefault();
      fired = false;
    }
  });
  document.addEventListener("touchcancel", cancel);
  document.addEventListener("click", (e) => {
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }
  }, true);
}
const BUCKETS = [["b192", "24-bit \xB7 above 96 kHz"], ["b96", "24-bit \xB7 88.2\u201396 kHz"], ["b48", "24-bit \xB7 44.1\u201348 kHz"], ["cd", "CD quality \xB7 16-bit"], ["lossy", "Lossy (MP3, AAC\u2026)"]];
const FILTERS = {
  hires: ["Hi-res albums", (a) => Catalog.bucket(a).startsWith("b")],
  cd: ["CD-quality albums", (a) => Catalog.bucket(a) === "cd"],
  lossy: ["Albums with lossy files", (a) => a[13] > 0],
  untagged: ["Albums missing volume tags", (a) => a[12] < a[11]],
  ...Object.fromEntries(BUCKETS.map(([k, l]) => [k, [l, (a) => Catalog.bucket(a) === k]]))
};
View.collection = async (main, params, filter) => {
  const draw = () => {
    if (UI.route.name !== "collection") return;
    const d = Catalog.load();
    const p = Catalog.progress;
    const reading = p ? '<p class="section-note" id="coll-progress">Reading your library\u2026 '.concat(p.done.toLocaleString()).concat(p.total ? " of ".concat(p.total.toLocaleString()) : "", " songs</p>") : "";
    if (filter && FILTERS[filter] && d) {
      const [title, test] = FILTERS[filter];
      const list = Object.entries(d.albums).filter(([, a]) => test(a)).map(([id, a]) => ({ id, name: a[0], artist: a[1], coverArt: a[2] })).sort((x, y) => x.artist.localeCompare(y.artist) || x.name.localeCompare(y.name));
      main.innerHTML = '<div class="page-head"><h1 class="page-title">'.concat(esc(title), '</h1><a class="btn" href="#/collection">').concat(icon("bars"), "Collection</a></div>\n        ").concat(filter === "untagged" && list.length ? '<p class="section-note">These albums play without volume levelling. Adding ReplayGain tags (for example with rsgain on the server) fixes that.</p>' : "", "\n        ").concat(list.length ? grid(list) : '<div class="empty"><h3>None</h3><p>Nothing in your library matches.</p></div>');
      return;
    }
    if (!d) {
      main.innerHTML = '<h1 class="page-title">Collection</h1>'.concat(reading || '<p class="section-note">Reading your library\u2026</p>');
      return;
    }
    const all = Object.values(d.albums).filter((a) => a[11]);
    const n = all.length || 1;
    const count = (f) => all.filter(FILTERS[f][1]).length;
    const hires = count("hires"), cd = count("cd"), lossy = count("lossy"), untagged = count("untagged");
    const bytes = all.reduce((t, a) => t + a[10], 0);
    const per = BUCKETS.map(([k, l]) => [k, l, all.filter((a) => Catalog.bucket(a) === k).length]);
    const max = Math.max(1, ...per.map((x) => x[2]));
    const pct = (v) => "".concat(Math.round(v / n * 100), "%");
    main.innerHTML = '<h1 class="page-title">Collection</h1>\n      '.concat(reading, '\n      <div class="tiles">\n        <a class="tile" href="#/collection/hires"><span class="label">Hi-res albums</span><b>').concat(hires.toLocaleString(), "</b><span>").concat(pct(hires), ' of your albums</span></a>\n        <a class="tile" href="#/collection/cd"><span class="label">CD quality</span><b>').concat(cd.toLocaleString(), "</b><span>").concat(pct(cd), '</span></a>\n        <a class="tile" href="#/collection/lossy"><span class="label">Lossy files</span><b>').concat(lossy.toLocaleString(), "</b><span>").concat(lossy ? "albums with MP3, AAC or similar" : "none, all lossless", '</span></a>\n        <a class="tile').concat(untagged ? " warn" : "", '" href="#/collection/untagged"><span class="label">Volume tags</span><b>').concat(untagged ? untagged.toLocaleString() : "All", "</b><span>").concat(untagged ? "albums missing them (".concat(pct(untagged), ")") : "every album is tagged", "</span></a>\n      </div>\n      ").concat(Growth.html(all), "\n      ").concat(section("By resolution", '<div class="res-bars">'.concat(per.map(([k, l, v]) => '<a class="res-row" href="#/collection/'.concat(k, '">\n          <span class="res-label">').concat(esc(l), '</span><span class="res-bar"><i style="width:').concat(v / max * 100, '%"></i></span><span class="res-n">').concat(v.toLocaleString(), "</span></a>")).join(""), "</div>")), '\n      <p class="coll-foot">').concat(all.length.toLocaleString(), " albums \xB7 ").concat(d.songs.toLocaleString(), " songs").concat(bytes ? " \xB7 ".concat(fmtSize(bytes)) : "", " \xB7 read ").concat(esc(new Date(d.at).toLocaleDateString(void 0, { day: "numeric", month: "long" })), '\n        <button class="btn btn-link" data-act="coll-reread">Read again</button></p>\n      <div id="coll-rated"></div>');
    const top = (d.rated || []).filter((s) => s.userRating >= 4).sort((x, y) => y.userRating - x.userRating).slice(0, 20);
    if (top.length) {
      $("#coll-rated").innerHTML = '<section class="section"><div class="section-head"><h2>Your Top Rated Songs</h2><a href="#" data-act="mix-top">Play your 5-star songs</a></div>'.concat(trackRows(register(top), { art: true, numbers: "index" }), "</section>");
      markPlaying();
    }
  };
  UI.collectionTick = draw;
  draw();
  if (!Catalog.building) Catalog.ensure().then(draw).catch((e) => toast(e.message));
};
const Growth = {
  metric: "albums",
  METRICS: { albums: ["Albums", () => 1, (v) => v.toLocaleString()], songs: ["Songs", (a) => a[11], (v) => v.toLocaleString()], size: ["Storage", (a) => a[10], (v) => fmtSize(v) || "0 MB"] },
  monthName: (m) => (/* @__PURE__ */ new Date(m + "-15")).toLocaleDateString(void 0, { month: "long", year: "numeric" }),
  html(all) {
    const dated = all.filter((a) => a[15]);
    if (dated.length < 2) return "";
    const [label, val, fmt] = this.METRICS[this.metric];
    const first = dated.reduce((m, a) => a[15] < m ? a[15] : m, "9999");
    const now = /* @__PURE__ */ new Date(), end = "".concat(now.getFullYear(), "-").concat(String(now.getMonth() + 1).padStart(2, "0"));
    const months = [];
    for (let [y2, mo] = first.split("-").map(Number); "".concat(y2, "-").concat(String(mo).padStart(2, "0")) <= end; mo === 12 ? (y2++, mo = 1) : mo++) months.push("".concat(y2, "-").concat(String(mo).padStart(2, "0")));
    const add = Object.fromEntries(months.map((m) => [m, 0])), addN = Object.fromEntries(months.map((m) => [m, 0]));
    for (const a of dated) {
      add[a[15]] += val(a);
      addN[a[15]]++;
    }
    const rest = months.slice(1).map((m) => addN[m]);
    const base = months.length > 1 && addN[months[0]] >= dated.length * 0.4 && addN[months[0]] >= 3 * Math.max(1, ...rest);
    let total = 0;
    const pts = months.map((m) => total += add[m]);
    const W = innerWidth < 760 ? 380 : 720, H = innerWidth < 760 ? 200 : 220, P = 8, n = months.length, top = Math.max(1, total);
    const lo = base ? pts[0] * 0.9 : 0;
    const x = (i) => P + (n === 1 ? (W - 2 * P) / 2 : i * (W - 2 * P) / (n - 1));
    const y = (v) => H - 30 - (v - lo) / Math.max(1, top - lo) * (H - 50);
    const barMax = Math.max(1, ...months.slice(base ? 1 : 0).map((m) => add[m]));
    const bw = Math.max(2, Math.min(18, (W - 2 * P) / n - 3));
    const line = pts.map((v, i) => "".concat(i ? "L" : "M").concat(x(i).toFixed(1), ",").concat(y(v).toFixed(1))).join("");
    const bars = months.map((m, i) => i === 0 && base || !add[m] ? "" : '<rect class="g-bar" x="'.concat((x(i) - bw / 2).toFixed(1), '" y="').concat((H - 22 - add[m] / barMax * 34).toFixed(1), '" width="').concat(bw.toFixed(1), '" height="').concat((add[m] / barMax * 34).toFixed(1), '"/>')).join("");
    const hits = months.map((m, i) => '<rect class="g-hit" x="'.concat((x(i) - W / n / 2).toFixed(1), '" y="0" width="').concat((W / n).toFixed(1), '" height="').concat(H, '"><title>').concat(esc(this.monthName(m)), ": ").concat(i === 0 && base ? "starting point, " : add[m] ? "+" : "").concat(esc(fmt(add[m]))).concat(i === 0 && base ? "" : " added", " \xB7 ").concat(esc(fmt(pts[i])), " total</title></rect>")).join("");
    const ticks = months.map((m, i) => (i === 0 || i === n - 1 || m.endsWith("-01")) && (i === 0 || i === n - 1 || Math.abs(i - (n - 1)) > n / 12) ? '<text class="g-tick" x="'.concat(x(i).toFixed(1), '" y="').concat(H - 6, '" text-anchor="').concat(i === 0 ? "start" : i === n - 1 ? "end" : "middle", '">').concat(m.endsWith("-01") && i && i !== n - 1 ? m.slice(0, 4) : esc((/* @__PURE__ */ new Date(m + "-15")).toLocaleDateString(void 0, { month: "short", year: "numeric" })), "</text>") : "").join("");
    const later = months.slice(base ? 1 : 0).filter((m) => add[m]);
    const best = later.sort((a, b) => add[b] - add[a])[0];
    const note = base ? "Started with ".concat(fmt(pts[0])).concat(this.metric === "size" ? "" : " " + label.toLowerCase(), " in ").concat(this.monthName(months[0]), ", when Navidrome first scanned your library. ").concat(best ? "Since then: +".concat(fmt(total - pts[0]), ". Biggest month: ").concat(this.monthName(best), " (+").concat(fmt(add[best]), ").") : "Nothing added since.") : best ? "Biggest month: ".concat(this.monthName(best), " (+").concat(fmt(add[best]), ").") : "";
    const chips = Object.entries(this.METRICS).map(([k, [l]]) => '<button class="chip'.concat(k === this.metric ? " on" : "", '" data-act="growth-metric" data-m="').concat(k, '">').concat(l, "</button>")).join("");
    return section("Your Collection Over Time", '<div class="chips growth-chips">'.concat(chips, '</div><p class="section-note">').concat(esc(note), '</p>\n      <svg class="growth" viewBox="0 0 ').concat(W, " ").concat(H, '" role="img" aria-label="').concat(esc(label), ' in your collection over time">\n        <path class="g-area" d="').concat(line, "L").concat(x(n - 1).toFixed(1), ",").concat(H - 22, "L").concat(x(0).toFixed(1), ",").concat(H - 22, 'Z"/><path class="g-line" d="').concat(line, '"/>').concat(bars).concat(hits).concat(ticks, "</svg>"));
  }
};
actions["growth-metric"] = (el) => {
  var _a;
  Growth.metric = el.dataset.m;
  (_a = UI.collectionTick) == null ? void 0 : _a.call(UI);
};
actions["coll-reread"] = async () => {
  await Catalog.build(await API.call("getScanStatus").then((r) => r.scanStatus).catch(() => null));
};
{
  const nav = $(".side-nav");
  if (nav && !$('[data-nav="collection"]', nav)) {
    const after = $('[data-nav="playlists"]', nav);
    after == null ? void 0 : after.insertAdjacentHTML("afterend", '<a href="#/collection" data-nav="collection"><span class="ico">'.concat(icon("bars"), "</span>Collection</a>"));
  }
  const lib = View.library;
  View.library = async (main) => {
    var _a;
    const p = lib(main);
    const links = $(".lib-links", main);
    if (links && !$('[href="#/collection"]', links)) (_a = $('[href="#/playlists"]', links)) == null ? void 0 : _a.insertAdjacentHTML("afterend", '<a href="#/collection"><span class="ico">'.concat(icon("bars"), "</span>Collection</a>"));
    return p;
  };
}
window.Catalog = Catalog;
window.Rating = Rating;
const Scan = {
  busy: false,
  status() {
    return API.call("getScanStatus").then((r) => r.scanStatus || {}).catch(() => null);
  },
  async run(btn) {
    var _a;
    if (this.busy) return;
    this.busy = true;
    const label = btn == null ? void 0 : btn.textContent;
    const set = (t) => {
      if (btn == null ? void 0 : btn.isConnected) btn.textContent = t;
    };
    try {
      let st = await this.status();
      const before = (_a = st == null ? void 0 : st.count) != null ? _a : null;
      if (!(st == null ? void 0 : st.scanning)) {
        set("Starting\u2026");
        st = (await API.call("startScan")).scanStatus || st;
      }
      const t0 = Date.now();
      while ((st == null ? void 0 : st.scanning) && Date.now() - t0 < 20 * MIN) {
        set(st.count ? "Scanning\u2026 ".concat(Number(st.count).toLocaleString(), " songs") : "Scanning\u2026");
        await sleep(1500);
        st = await this.status();
      }
      API.bust();
      Catalog.ensure().catch(() => {
      });
      const now = st == null ? void 0 : st.count;
      const diff = before != null && now != null ? now - before : 0;
      toast(diff > 0 ? "Scan finished: ".concat(plural(diff, "new song"), ". ").concat(Number(now).toLocaleString(), " in your library.") : diff < 0 ? "Scan finished: ".concat(plural(-diff, "song"), " no longer found. ").concat(Number(now).toLocaleString(), " in your library.") : "Scan finished. Nothing new found".concat(now != null ? ": ".concat(Number(now).toLocaleString(), " songs.") : "."));
      UI.render();
    } catch (e) {
      toast(e.code === 50 ? "Navidrome only lets an admin account start a scan." : "Couldn't scan: ".concat(e.message || "unknown error"));
    } finally {
      this.busy = false;
      set(label);
    }
  }
};
actions["scan-library"] = (el) => Scan.run(el);
{
  const orig = View.settings;
  View.settings = async (main, ...rest) => {
    await orig(main, ...rest);
    const box = $(".settings", main);
    if (!box || $('[data-act="scan-library"]', box)) return;
    box.insertAdjacentHTML("afterbegin", '<h2 class="set-group">Library</h2>\n      <div class="set-row"><div><h3>Scan library</h3><p>Look for new music in your folders. Added albums appear in Mar\xE9 as soon as Navidrome finishes.</p></div>\n        <div class="set-actions"><button class="btn" data-act="scan-library">Scan library</button></div></div>');
  };
}
window.Scan = Scan;
const RateSync = {
  mb() {
    return store.get("mbauth") || {};
  },
  mbOn() {
    return !!this.mb().refresh;
  },
  redirect() {
    return location.origin + location.pathname;
  },
  oauth() {
    return API.base ? "https://musicbrainz.org/oauth2" : "/mbo";
  },
  async mbid(s) {
    if (s.musicBrainzId) return s.musicBrainzId;
    const map = store.get("rmbid") || {};
    if (s.id in map) return map[s.id];
    let r = null;
    try {
      r = await LB.get("metadata/lookup/", { artist_name: s.artist, recording_name: s.title, release_name: s.album });
    } catch (e) {
      if (e.code === 0 || e.code === 429) throw e;
    }
    map[s.id] = (r == null ? void 0 : r.recording_mbid) || null;
    store.set("rmbid", map);
    return map[s.id];
  },
  async love(mbid, on) {
    const tk = LB.cfg().token;
    if (!tk) return false;
    const res = await fetch("".concat(LB.base(), "/1/feedback/recording-feedback"), {
      method: "POST",
      headers: { Authorization: "Token " + tk, "Content-Type": "application/json" },
      body: JSON.stringify({ recording_mbid: mbid, score: on ? 1 : 0 })
    });
    if (!res.ok) throw new ApiError("ListenBrainz returned ".concat(res.status, "."), res.status);
    return true;
  },
  async token() {
    const c = this.mb();
    if (c.access && c.exp > Date.now() + 6e4) return c.access;
    const t = await this.grant({ grant_type: "refresh_token", refresh_token: c.refresh });
    return t.access_token;
  },
  async grant(fields) {
    const c = this.mb();
    const res = await fetch("".concat(this.oauth(), "/token"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: c.client, client_secret: c.secret })
    });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) throw new ApiError(t.error_description || "MusicBrainz didn't accept the sign-in.", res.status);
    store.set("mbauth", { ...this.mb(), access: t.access_token, refresh: t.refresh_token || c.refresh, exp: Date.now() + (t.expires_in || 3600) * 1e3 });
    return t;
  },
  // pairs: [[recording MBID, stars 0–5], …]
  async rate(pairs) {
    const tk = await this.token();
    for (let i = 0; i < pairs.length; i += 50) {
      const xml = '<metadata xmlns="http://musicbrainz.org/ns/mmd-2.0#"><recording-list>'.concat(pairs.slice(i, i + 50).map(([id, n]) => '<recording id="'.concat(esc(id), '"><user-rating>').concat(n * 20, "</user-rating></recording>")).join(""), "</recording-list></metadata>");
      const res = await fetch("".concat(MB.base(), "/rating?client=").concat(encodeURIComponent("Mare-" + window.MARE_VERSION)), {
        method: "POST",
        headers: { Authorization: "Bearer " + tk, "Content-Type": "application/xml; charset=UTF-8" },
        body: xml
      });
      if (!res.ok) throw new ApiError("MusicBrainz returned ".concat(res.status, "."), res.status);
      if (i + 50 < pairs.length) await sleep(1100);
    }
  },
  // After rating one song in Maré.
  async song(s, n, prev) {
    const lb = LB.cfg().token && (n === 5 || prev === 5);
    if (!lb && !this.mbOn()) return;
    const id = await this.mbid(s);
    if (!id) {
      toast("Couldn't find \u201C".concat(s.title, "\u201D on MusicBrainz, so the rating stays in Navidrome only"));
      return;
    }
    if (lb) await this.love(id, n === 5);
    if (this.mbOn()) await this.rate([[id, n]]);
  },
  // Settings: every rated song in the library.
  async all(btn) {
    var _a;
    if (!Catalog.load()) {
      btn.disabled = true;
      btn.textContent = "Reading your library\u2026";
      await Catalog.ensure().catch(() => {
      });
      btn.disabled = false;
      btn.textContent = "Send all";
    }
    const rated = (((_a = Catalog.load()) == null ? void 0 : _a.rated) || []).filter((s) => s.userRating);
    if (!rated.length) {
      toast("No rated songs yet (or the library is still being read)");
      return;
    }
    const label = btn.textContent;
    btn.disabled = true;
    let sent = 0, missing = 0;
    const pairs = [];
    try {
      for (const [i, s] of rated.entries()) {
        btn.textContent = "Finding songs\u2026 ".concat(i + 1, "/").concat(rated.length);
        const id = await this.mbid(s);
        if (!id) {
          missing++;
          continue;
        }
        if (s.userRating === 5 && LB.cfg().token) await this.love(id, true);
        pairs.push([id, s.userRating]);
        sent++;
        if (!s.musicBrainzId) await sleep(250);
      }
      if (this.mbOn() && pairs.length) {
        btn.textContent = "Sending stars to MusicBrainz\u2026";
        await this.rate(pairs);
      }
      const loved = rated.filter((s) => s.userRating === 5).length;
      toast("Sent ".concat(sent, " of ").concat(rated.length, " ratings").concat(LB.cfg().token ? " (".concat(loved, " loved on ListenBrainz)") : "", ".").concat(missing ? " ".concat(missing, " not found on MusicBrainz.") : ""));
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  },
  connect(form) {
    const client = form.client.value.trim(), secret = form.secret.value.trim();
    if (!client || !secret) {
      toast("Paste both the client ID and the client secret");
      return;
    }
    const state = Math.random().toString(36).slice(2);
    store.set("mbauth", { client, secret, state });
    location.href = "https://musicbrainz.org/oauth2/authorize?" + new URLSearchParams({
      response_type: "code",
      client_id: client,
      redirect_uri: this.redirect(),
      scope: "rating profile",
      state,
      access_type: "offline"
    });
  },
  // Back from MusicBrainz with ?code=…
  async finish() {
    var _a;
    const q = new URLSearchParams(location.search), code = q.get("code"), c = this.mb();
    if (!code || !c.state || q.get("state") !== c.state) return;
    history.replaceState(null, "", this.redirect() + "#/settings");
    try {
      await this.grant({ grant_type: "authorization_code", code, redirect_uri: this.redirect() });
      const me = await fetch("".concat(this.oauth(), "/userinfo"), { headers: { Authorization: "Bearer " + this.mb().access } }).then((r) => r.json()).catch(() => ({}));
      store.set("mbauth", { ...this.mb(), state: "", user: me.sub || "" });
      toast("MusicBrainz connected. Your stars will be sent there too.");
    } catch (e) {
      toast(e.message);
    }
    if (((_a = UI.route) == null ? void 0 : _a.name) === "settings") UI.render();
  }
};
RateSync.finish();
{
  const set = Rating.set.bind(Rating);
  Rating.set = async (kind, id, n) => {
    const s = kind === "song" ? Songs.get(id) : null, prev = (s == null ? void 0 : s.userRating) || 0;
    await set(kind, id, n);
    if (s) RateSync.song(s, n, prev).catch((e) => toast(e.message));
  };
}
Object.assign(actions, {
  "rate-sync-all": (el) => RateSync.all(el),
  "mb-disconnect": () => {
    store.del("mbauth");
    toast("MusicBrainz disconnected");
    UI.render();
  }
});
{
  const orig = View.settings;
  View.settings = async (main, ...rest) => {
    await orig(main, ...rest);
    const box = $(".settings", main);
    if (!box || $(".rate-sync", box)) return;
    const c = RateSync.mb(), lb = !!LB.cfg().token;
    const html = '<h2 class="set-group rate-sync">Ratings</h2>\n      <div class="set-row"><div><h3>ListenBrainz</h3><p>'.concat(lb ? "Songs you rate 5 stars are marked as Loved on ListenBrainz, which helps your recommendations. Taking the fifth star away removes the Love." : "Add your ListenBrainz token to send your 5-star songs there as Loved.", '</p></div></div>\n      <div class="set-row"><div><h3>MusicBrainz</h3>').concat(RateSync.mbOn() ? "<p>Connected".concat(c.user ? " as <b>".concat(esc(c.user), "</b>") : "", '. Every star rating you give is also sent to MusicBrainz (public ratings).</p></div>\n        <div class="set-actions"><button class="btn" data-act="mb-disconnect">Disconnect</button></div></div>') : '<p>Send your exact stars to MusicBrainz. One-time setup: on <a href="https://musicbrainz.org/account/applications" target="_blank" rel="noopener">musicbrainz.org \u2192 Applications</a>, register an application of type <b>Web Application</b> with this callback URL: <code>'.concat(esc(RateSync.redirect()), '</code>. Then paste its client ID and secret here.</p>\n          <form class="mb-form"><input class="input" name="client" placeholder="Client ID" autocomplete="off"><input class="input" name="secret" placeholder="Client secret" autocomplete="off"><button class="btn btn-primary">Connect</button></form></div></div>'), '\n      <div class="set-row"><div><h3>Send all my ratings</h3><p>Sends every song you\'ve already rated (also ones rated in Navidrome itself). Songs are matched by artist and title, so a few may not be found.</p></div>\n        <div class="set-actions"><button class="btn" data-act="rate-sync-all">Send all</button></div></div>');
    const acct = [...$$(".set-group", box)].find((h) => h.textContent === "Account");
    if (acct) acct.insertAdjacentHTML("beforebegin", html);
    else box.insertAdjacentHTML("beforeend", html);
    const f = $(".mb-form", box);
    if (f) f.addEventListener("submit", (e) => {
      e.preventDefault();
      RateSync.connect(f);
    });
  };
}
window.RateSync = RateSync;
