"use strict";
const Geo = {
  d: null,
  // { v, a: { artistId: 'PT' | '-' (looked up, none found) }, areas: { musicBrainzAreaId: 'US' | '-' },
  //   p: { artistId: ['c' | 'r', name, areaId] | 0 } } — p (1.8.4) is the place finer than the country: a city or town
  //   ('c') or only a region ('r'); 0 when MusicBrainz knows none.
  data() {
    if (!this.d) {
      const x = store.get("geo");
      this.d = x && x.v === 1 ? x : { v: 1, a: {}, areas: {} };
    }
    if (!this.d.p) this.d.p = {};
    return this.d;
  },
  save() {
    store.set("geo", this.data());
  },
  // Album artists, the same list as the Artists page.
  async artists() {
    var _a;
    const r = await API.call("getArtists", {}, { cache: 5 * MIN });
    return (((_a = r.artists) == null ? void 0 : _a.index) || []).flatMap((i) => i.artist || []);
  },
  // Of MusicBrainz's search results, the one that IS this artist: same name (or one of its aliases). The top result
  // always scores 100, even when it is somebody else, so the score alone proves nothing.
  pick(list, name) {
    const n = norm(name);
    return (list || []).find((x) => {
      var _a;
      return ((_a = x.score) != null ? _a : 100) >= 85 && (norm(x.name) === n || (x.aliases || []).some((al) => norm(al.name) === n));
    }) || null;
  },
  codeOf(a) {
    var _a, _b;
    const c1 = (_a = a == null ? void 0 : a["iso-3166-1-codes"]) == null ? void 0 : _a[0];
    if (c1) return c1;
    const c2 = (_b = a == null ? void 0 : a["iso-3166-2-codes"]) == null ? void 0 : _b[0];
    return c2 ? c2.slice(0, 2) : "";
  },
  // The country a MusicBrainz area belongs to. Many people are filed under a city ("Chicago"): walk up through
  // "part of" until something carries a country code. Every area on the way is remembered.
  async area(ar) {
    var _a;
    const D = this.data(), trail = [];
    let id = ar == null ? void 0 : ar.id, code = "";
    for (let hop = 0; id && hop < 5 && !code; hop++) {
      if (D.areas[id]) {
        code = D.areas[id] === "-" ? "" : D.areas[id];
        break;
      }
      trail.push(id);
      const r = await MB.get("area/" + id, { inc: "area-rels" });
      if (!r || r.error) throw new ApiError("MusicBrainz is busy.", 503);
      code = this.codeOf(r);
      if (code) break;
      const up = (_a = (r.relations || []).find((x) => x.type === "part of" && x.direction === "backward" && x.area)) == null ? void 0 : _a.area;
      if (!up) break;
      code = this.codeOf(up);
      id = up.id;
    }
    trail.forEach((t) => {
      D.areas[t] = code || "-";
    });
    return code;
  },
  // Where the artist formed (a band) or was born (a person), finer than the country. A search answer names the kind
  // of place; an answer by MusicBrainz id doesn't, and is counted as a town (most are).
  placeOf(a) {
    var _a, _b;
    const home = (_a = a == null ? void 0 : a.area) == null ? void 0 : _a.id;
    for (const ar of [(a == null ? void 0 : a["begin-area"]) || (a == null ? void 0 : a.begin_area), a == null ? void 0 : a.area]) {
      if (!(ar == null ? void 0 : ar.id) || ar.type === "Country" || ((_b = ar["iso-3166-1-codes"]) == null ? void 0 : _b.length) || (ar === a.area ? !ar.type : ar.id === home)) continue;
      return [ar.type === "Subdivision" ? "r" : "c", ar.name || "", ar.id];
    }
    return 0;
  },
  // The artist as MusicBrainz knows them, or null.
  async find(artist) {
    if (/^(various artists|\[?unknown artist\]?)$/i.test(artist.name || "")) return null;
    let a = null;
    if (artist.musicBrainzId) a = await MB.get("artist/" + artist.musicBrainzId).catch((e) => {
      if (e.code === 404 || e.code === 400) return null;
      throw e;
    });
    else {
      const clean = String(artist.name).replace(/["\\]/g, " ").trim(), bare = clean.replace(/^the\s+/i, "");
      for (const q of bare !== clean ? [clean, bare] : [clean]) {
        const r = await MB.get("artist", { query: 'artist:"'.concat(q, '" OR alias:"').concat(q, '"'), limit: 5 });
        if (!Array.isArray(r == null ? void 0 : r.artists)) throw new ApiError("MusicBrainz is busy.", 503);
        a = this.pick(r.artists, artist.name) || this.pick(r.artists, bare);
        if (a) break;
      }
    }
    return a;
  },
  async lookup(artist) {
    const a = await this.find(artist);
    if (!a) return "-";
    this.data().p[artist.id] = this.placeOf(a);
    return a.country || await this.area(a["begin-area"] || a.begin_area) || await this.area(a.area) || "-";
  },
  // Look up every artist that has no answer yet, one after the other (so a discography request made meanwhile
  // only ever waits for one of these). Stops quietly when MusicBrainz can't be reached; the next visit carries on.
  running: false,
  async build(tick) {
    if (this.running) return;
    this.running = true;
    try {
      const list = await this.artists(), D = this.data();
      let n = 0;
      for (const ar of list) {
        const have = D.a[ar.id];
        if (have && (have === "-" || D.p[ar.id] !== void 0)) continue;
        let c;
        try {
          if (have) {
            const a = await this.find(ar);
            D.p[ar.id] = a ? this.placeOf(a) : 0;
            c = have;
          } else c = await this.lookup(ar);
        } catch (e) {
          if (!e.code || e.code === 503 || e.code === 429) {
            clearTimeout(this.again);
            this.again = setTimeout(() => this.build(tick), 6e4);
            break;
          }
          c = "-";
        }
        D.a[ar.id] = c;
        if (++n % 5 === 0) this.save();
        tick == null ? void 0 : tick();
      }
      this.save();
    } catch {
    } finally {
      this.running = false;
      tick == null ? void 0 : tick();
    }
  },
  // Ask again about the artists that weren't found (MusicBrainz gains artists and countries all the time).
  retry(tick) {
    const D = this.data();
    Object.keys(D.a).forEach((id) => {
      if (D.a[id] === "-") delete D.a[id];
    });
    Object.keys(D.areas).forEach((id) => {
      if (D.areas[id] === "-") delete D.areas[id];
    });
    this.save();
    return this.build(tick);
  },
  // { countries: [{ code, artists }] most artists first, unknown: [artists], pending, total }
  async summary() {
    const list = await this.artists(), D = this.data(), by = /* @__PURE__ */ new Map(), unknown = [];
    let pending = 0;
    for (const ar of list) {
      const c = D.a[ar.id];
      if (!c) pending++;
      else if (c === "-") unknown.push(ar);
      else {
        if (!by.has(c)) by.set(c, []);
        by.get(c).push(ar);
      }
    }
    const countries = [...by].map(([code, artists]) => ({ code, artists })).sort((x, y) => y.artists.length - x.artists.length || x.code.localeCompare(y.code));
    const places = { cities: 0, regions: 0, asked: 0, pending: 0 };
    for (const ar of list) {
      const c = D.a[ar.id];
      if (!c || c === "-") continue;
      const pl = D.p[ar.id];
      if (pl === void 0) {
        places.pending++;
        continue;
      }
      places.asked++;
      if (pl) places[pl[0] === "r" ? "regions" : "cities"]++;
    }
    return { countries, unknown, pending, total: list.length, places };
  }
};
const Atlas = {
  rot: [10, -22],
  sel: null,
  spin: true,
  all: false,
  lib: null,
  libP: null,
  sum: null,
  box: null,
  SIZE: 600,
  R: 288,
  loadLib() {
    if (window.MareGlobe) return Promise.resolve(window.MareGlobe);
    if (!this.libP) {
      this.libP = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "globe-lib.js?v=".concat(window.MARE_VERSION);
        s.onload = () => window.MareGlobe ? res(window.MareGlobe) : rej(new Error("map"));
        s.onerror = () => {
          this.libP = null;
          rej(new Error("map"));
        };
        document.head.appendChild(s);
      });
    }
    return this.libP;
  },
  name(code) {
    var _a, _b;
    if (code === "-") return "Country not found";
    try {
      const n = new Intl.DisplayNames([navigator.language || "en", "en"], { type: "region" }).of(code);
      if (n && n !== code) return n;
    } catch {
    }
    return ((_b = (_a = this.lib) == null ? void 0 : _a.countries.find((c) => c.code === code)) == null ? void 0 : _b.name) || code;
  },
  // Called by the Collection page every time it draws itself.
  async mount(box) {
    if (!box) return;
    this.box = box;
    box.innerHTML = '<section class="section atlas"><div class="section-head"><h2>Where Your Artists Are From</h2></div>\n      <p class="section-note atlas-note">Loading the map\u2026</p><p class="section-note atlas-places" hidden></p>\n      <div class="atlas-grid"><div class="atlas-globe"></div><div class="atlas-side"></div></div></section>';
    try {
      this.lib = await this.loadLib();
    } catch {
      if (box.isConnected) $(".atlas-note", box).textContent = "The map couldn't be loaded. Check the connection and open Collection again.";
      return;
    }
    if (!box.isConnected) return;
    this.sum = await Geo.summary().catch(() => null);
    if (!this.sum || !box.isConnected) return;
    this.globe($(".atlas-globe", box));
    this.refresh();
    if (this.sum.pending || this.sum.places.pending) Geo.build(() => this.onProgress());
  },
  // New answers arrived: refresh the numbers now and then (not on every single artist).
  async onProgress() {
    var _a, _b;
    if (!((_a = this.box) == null ? void 0 : _a.isConnected)) return;
    const now = Date.now();
    if (Geo.running && now - (this.lastTick || 0) < 2500) return;
    this.lastTick = now;
    this.sum = await Geo.summary().catch(() => this.sum);
    if ((_b = this.box) == null ? void 0 : _b.isConnected) this.refresh();
  },
  count(code) {
    var _a, _b;
    return ((_b = (_a = this.sum) == null ? void 0 : _a.countries.find((c) => c.code === code)) == null ? void 0 : _b.artists.length) || 0;
  },
  refresh() {
    const s = this.sum, box = this.box;
    if (!s || !(box == null ? void 0 : box.isConnected)) return;
    const max = Math.max(1, ...s.countries.map((c) => c.artists.length));
    const level = (n) => !n ? 0 : max <= 1 ? 2 : 1 + Math.round(3 * Math.log(n) / Math.log(max));
    (this.paths || []).forEach(([el, c]) => {
      const n = this.count(c.code);
      el.setAttribute("class", "gl-c gl-l".concat(level(n)).concat(this.sel === c.code ? " on" : ""));
      el.firstChild.textContent = "".concat(this.name(c.code) || c.name).concat(n ? " \xB7 ".concat(plural(n, "artist")) : "");
    });
    const found = s.total - s.pending;
    $(".atlas-note", box).textContent = s.pending ? "Finding out where your artists are from: ".concat(found.toLocaleString(), " of ").concat(s.total.toLocaleString(), " so far. MusicBrainz answers about one a second; this happens once and carries on whenever Mar\xE9 is open.") : "".concat(s.countries.length, " ").concat(s.countries.length === 1 ? "country" : "countries", " \xB7 ").concat(plural(s.total - s.unknown.length, "artist"), " placed").concat(s.unknown.length ? " \xB7 ".concat(s.unknown.length, " not found on MusicBrainz") : "", ". Drag the globe, or pick a country.");
    const pl = s.places, line = $(".atlas-places", box);
    if (line) {
      line.hidden = !pl.asked;
      line.textContent = "MusicBrainz knows the town for ".concat(pl.cities.toLocaleString(), " of ").concat(pl.asked.toLocaleString(), " placed artists").concat(pl.regions ? ", and only the region for ".concat(pl.regions.toLocaleString(), " more") : "").concat(pl.pending ? ". Still asking about ".concat(pl.pending.toLocaleString(), ".") : ".");
    }
    if (!this.sel && s.countries.length) this.sel = s.countries[0].code;
    this.side();
  },
  side() {
    const s = this.sum, side = $(".atlas-side", this.box);
    if (!side) return;
    const rows = s.countries.concat(s.unknown.length ? [{ code: "-", artists: s.unknown }] : []);
    const cur = rows.find((c) => c.code === this.sel);
    const shown = this.all ? rows : rows.slice(0, 8);
    const chips = ((cur == null ? void 0 : cur.artists) || []).slice().sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0) || a.name.localeCompare(b.name));
    side.innerHTML = "".concat(cur ? '<div class="atlas-sel"><span class="label">'.concat(cur.code === "-" ? "Not placed" : "Selected", '</span>\n        <h3 class="cond">').concat(esc(this.name(cur.code)), '</h3><p class="atlas-n">').concat(plural(cur.artists.length, "artist"), "</p>\n        ").concat(cur.code === "-" ? '<p class="section-note">MusicBrainz has no country for these, or doesn\'t know them under this name. <button class="btn btn-link" data-act="atlas-retry">Try them again</button></p>' : "", '\n        <div class="chips">').concat(chips.slice(0, 40).map((a) => '<a class="chip" href="#/artist/'.concat(esc(a.id), '">').concat(esc(a.name), "</a>")).join("")).concat(chips.length > 40 ? '<span class="chip chip-more">and '.concat(chips.length - 40, " more</span>") : "", "</div></div>") : "", '\n      <div class="atlas-rank">').concat(shown.map((c, i) => '<button class="atlas-row'.concat(c.code === this.sel ? " on" : "", '" data-act="atlas-pick" data-c="').concat(esc(c.code), '">\n          <span class="atlas-no">').concat(c.code === "-" ? "" : i + 1, '</span><span class="atlas-name">').concat(esc(this.name(c.code)), '</span><span class="atlas-count">').concat(c.artists.length, "</span></button>")).join(""), "\n        ").concat(rows.length > 8 ? '<button class="btn btn-link" data-act="atlas-all">'.concat(this.all ? "Show fewer" : "Show all ".concat(rows.length), "</button>") : "", "</div>");
  },
  // ----- the globe: an SVG redrawn as it turns -----
  globe(host) {
    const G = this.lib, S = this.SIZE, ns = "http://www.w3.org/2000/svg";
    const el = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
      return e;
    };
    const svg = el("svg", { class: "globe", viewBox: "0 0 ".concat(S, " ").concat(S), role: "img", "aria-label": "Globe of your artists by country" });
    svg.appendChild(el("circle", { class: "gl-sea", cx: S / 2, cy: S / 2, r: this.R }));
    const grat = svg.appendChild(el("path", { class: "gl-grat" }));
    const land = svg.appendChild(el("g", {}));
    this.paths = G.countries.map((c) => {
      const p = land.appendChild(el("path", { class: "gl-c", "data-c": c.code }));
      p.appendChild(el("title"));
      return [p, c];
    });
    svg.appendChild(el("circle", { class: "gl-rim", cx: S / 2, cy: S / 2, r: this.R }));
    host.textContent = "";
    host.appendChild(svg);
    this.svg = svg;
    this.grat = grat;
    this.draw();
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0, rot: this.rot.slice(), t: e.target };
      this.spin = false;
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const k = S / (svg.clientWidth || S) * (180 / (Math.PI * this.R)), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      this.rot = [drag.rot[0] + dx * k, Math.max(-80, Math.min(80, drag.rot[1] - dy * k))];
      this.schedule();
    });
    const end = (e) => {
      var _a, _b;
      if (!drag) return;
      const d = drag;
      drag = null;
      const code = (_b = (_a = d.t) == null ? void 0 : _a.getAttribute) == null ? void 0 : _b.call(_a, "data-c");
      if (e.type === "pointerup" && d.moved < 6 && code && this.count(code)) this.pick(code);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    if (this.spin) this.turn();
  },
  draw() {
    const G = this.lib, S = this.SIZE;
    const path = G.geoPath(G.geoOrthographic().scale(this.R).translate([S / 2, S / 2]).rotate(this.rot).clipAngle(90));
    this.paths.forEach(([el, c]) => el.setAttribute("d", path(c.geo) || ""));
    this.grat.setAttribute("d", path(G.geoGraticule10()) || "");
  },
  schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      var _a;
      this.raf = 0;
      if ((_a = this.svg) == null ? void 0 : _a.isConnected) this.draw();
    });
  },
  // Turns slowly by itself until it is touched.
  turn() {
    let last = performance.now();
    const step = (t) => {
      var _a;
      if (!this.spin || !((_a = this.svg) == null ? void 0 : _a.isConnected)) return;
      if (!document.hidden) {
        this.rot = [this.rot[0] + (t - last) * 6e-3, this.rot[1]];
        this.draw();
      }
      last = t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  // Select a country (from the globe or the list) and turn the globe to face it.
  pick(code) {
    var _a, _b;
    this.sel = code;
    this.spin = false;
    this.refresh();
    const c = (_a = this.lib) == null ? void 0 : _a.countries.find((x) => x.code === code);
    if (!c || !((_b = this.svg) == null ? void 0 : _b.isConnected)) return;
    const [lon, lat] = this.lib.geoCentroid(c.geo), from = this.rot.slice();
    const to = [-lon, Math.max(-60, Math.min(60, -lat))];
    let d0 = ((to[0] - from[0]) % 360 + 540) % 360 - 180;
    const t0 = performance.now();
    const go = (t) => {
      var _a2;
      const k = Math.min(1, (t - t0) / 600), e = 1 - (1 - k) ** 3;
      this.rot = [from[0] + d0 * e, from[1] + (to[1] - from[1]) * e];
      if ((_a2 = this.svg) == null ? void 0 : _a2.isConnected) this.draw();
      if (k < 1 && this.sel === code) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  }
};
Object.assign(actions, {
  "atlas-pick": (el) => Atlas.pick(el.dataset.c),
  "atlas-all": () => {
    Atlas.all = !Atlas.all;
    Atlas.side();
  },
  "atlas-retry": () => {
    toast("Asking MusicBrainz again\u2026");
    Atlas.sel = null;
    Geo.retry(() => Atlas.onProgress());
    Atlas.onProgress();
  }
});
window.Geo = Geo;
window.Atlas = Atlas;
