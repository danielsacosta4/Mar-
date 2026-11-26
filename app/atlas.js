/* Maré — Round 9: where your artists are from. A globe on the Collection page: countries shaded by how many of your
   artists come from there, each one clickable. Navidrome doesn't know an artist's country, so it is looked up on
   MusicBrainz, one artist at a time (their limit is about one question a second) and remembered on this device.
   Loaded after moments.js (uses MB from shopping.js, norm from discover.js). The map itself (globe-lib.js, built by
   build/globe.sh) is only fetched when the Collection page is opened. */
'use strict';

const Geo = {
  d: null,
  // { v, a: { artistId: 'PT' | '-' (looked up, none found) }, areas: { musicBrainzAreaId: 'US' | '-' } }
  data() {
    if (!this.d) { const x = store.get('geo'); this.d = x && x.v === 1 ? x : { v: 1, a: {}, areas: {} }; }
    return this.d;
  },
  save() { store.set('geo', this.data()); },

  // Album artists, the same list as the Artists page.
  async artists() {
    const r = await API.call('getArtists', {}, { cache: 5 * MIN });
    return (r.artists?.index || []).flatMap((i) => i.artist || []);
  },

  // Of MusicBrainz's search results, the one that IS this artist: same name (or one of its aliases). The top result
  // always scores 100, even when it is somebody else, so the score alone proves nothing.
  pick(list, name) {
    const n = norm(name);
    return (list || []).find((x) => (x.score ?? 100) >= 85 && (norm(x.name) === n || (x.aliases || []).some((al) => norm(al.name) === n))) || null;
  },
  codeOf(a) {
    const c1 = a?.['iso-3166-1-codes']?.[0];
    if (c1) return c1;
    const c2 = a?.['iso-3166-2-codes']?.[0];
    return c2 ? c2.slice(0, 2) : '';
  },
  // The country a MusicBrainz area belongs to. Many people are filed under a city ("Chicago"): walk up through
  // "part of" until something carries a country code. Every area on the way is remembered.
  async area(ar) {
    const D = this.data(), trail = [];
    let id = ar?.id, code = '';
    for (let hop = 0; id && hop < 5 && !code; hop++) {
      if (D.areas[id]) { code = D.areas[id] === '-' ? '' : D.areas[id]; break; }
      trail.push(id);
      const r = await MB.get('area/' + id, { inc: 'area-rels' });
      if (!r || r.error) throw new ApiError('MusicBrainz is busy.', 503);
      code = this.codeOf(r);
      if (code) break;
      const up = (r.relations || []).find((x) => x.type === 'part of' && x.direction === 'backward' && x.area)?.area;
      if (!up) break;
      code = this.codeOf(up);
      id = up.id;
    }
    trail.forEach((t) => { D.areas[t] = code || '-'; });
    return code;
  },
  async lookup(artist) {
    if (/^(various artists|\[?unknown artist\]?)$/i.test(artist.name || '')) return '-';
    let a = null;
    if (artist.musicBrainzId) a = await MB.get('artist/' + artist.musicBrainzId).catch((e) => { if (e.code === 404 || e.code === 400) return null; throw e; });
    else {
      // By name, and once more without a leading "The" ("The Fatback Band" is filed as "Fatback Band").
      const clean = String(artist.name).replace(/["\\]/g, ' ').trim(), bare = clean.replace(/^the\s+/i, '');
      for (const q of bare !== clean ? [clean, bare] : [clean]) {
        const r = await MB.get('artist', { query: `artist:"${q}" OR alias:"${q}"`, limit: 5 });
        // An answer without a result list is MusicBrainz saying "slow down": not a "not found" to remember.
        if (!Array.isArray(r?.artists)) throw new ApiError('MusicBrainz is busy.', 503);
        a = this.pick(r.artists, artist.name) || this.pick(r.artists, bare);
        if (a) break;
      }
    }
    if (!a) return '-';
    // A person's "country" is often empty while the birthplace or home town is known.
    return a.country || await this.area(a['begin-area'] || a.begin_area) || await this.area(a.area) || '-';
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
        if (D.a[ar.id]) continue;
        let c;
        // MusicBrainz busy or unreachable: stop here and carry on in a minute (nothing is recorded for this artist).
        try { c = await this.lookup(ar); } catch (e) {
          if (!e.code || e.code === 503 || e.code === 429) { clearTimeout(this.again); this.again = setTimeout(() => this.build(tick), 60000); break; }
          c = '-';
        }
        D.a[ar.id] = c;
        if (++n % 5 === 0) this.save();
        tick?.();
      }
      this.save();
    } catch { /* offline: try again next time */ } finally { this.running = false; tick?.(); }
  },

  // Ask again about the artists that weren't found (MusicBrainz gains artists and countries all the time).
  retry(tick) {
    const D = this.data();
    Object.keys(D.a).forEach((id) => { if (D.a[id] === '-') delete D.a[id]; });
    Object.keys(D.areas).forEach((id) => { if (D.areas[id] === '-') delete D.areas[id]; });
    this.save();
    return this.build(tick);
  },

  // { countries: [{ code, artists }] most artists first, unknown: [artists], pending, total }
  async summary() {
    const list = await this.artists(), D = this.data(), by = new Map(), unknown = [];
    let pending = 0;
    for (const ar of list) {
      const c = D.a[ar.id];
      if (!c) pending++;
      else if (c === '-') unknown.push(ar);
      else { if (!by.has(c)) by.set(c, []); by.get(c).push(ar); }
    }
    const countries = [...by].map(([code, artists]) => ({ code, artists })).sort((x, y) => y.artists.length - x.artists.length || x.code.localeCompare(y.code));
    return { countries, unknown, pending, total: list.length };
  },
};

const Atlas = {
  rot: [10, -22], sel: null, spin: true, all: false, lib: null, libP: null, sum: null, box: null,
  SIZE: 600, R: 288,

  loadLib() {
    if (window.MareGlobe) return Promise.resolve(window.MareGlobe);
    if (!this.libP) {
      this.libP = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = `globe-lib.js?v=${window.MARE_VERSION}`;
        s.onload = () => (window.MareGlobe ? res(window.MareGlobe) : rej(new Error('map')));
        s.onerror = () => { this.libP = null; rej(new Error('map')); };
        document.head.appendChild(s);
      });
    }
    return this.libP;
  },
  name(code) {
    if (code === '-') return 'Country not found';
    try { const n = new Intl.DisplayNames([navigator.language || 'en', 'en'], { type: 'region' }).of(code); if (n && n !== code) return n; } catch { /* old browser */ }
    return this.lib?.countries.find((c) => c.code === code)?.name || code;
  },

  // Called by the Collection page every time it draws itself.
  async mount(box) {
    if (!box) return;
    this.box = box;
    box.innerHTML = `<section class="section atlas"><div class="section-head"><h2>Where Your Artists Are From</h2></div>
      <p class="section-note atlas-note">Loading the map…</p>
      <div class="atlas-grid"><div class="atlas-globe"></div><div class="atlas-side"></div></div></section>`;
    try { this.lib = await this.loadLib(); } catch { if (box.isConnected) $('.atlas-note', box).textContent = 'The map couldn\'t be loaded. Check the connection and open Collection again.'; return; }
    if (!box.isConnected) return;
    this.sum = await Geo.summary().catch(() => null);
    if (!this.sum || !box.isConnected) return;
    this.globe($('.atlas-globe', box));
    this.refresh();
    if (this.sum.pending) Geo.build(() => this.onProgress());
  },
  // New answers arrived: refresh the numbers now and then (not on every single artist).
  async onProgress() {
    if (!this.box?.isConnected) return;
    const now = Date.now();
    if (Geo.running && now - (this.lastTick || 0) < 2500) return;
    this.lastTick = now;
    this.sum = await Geo.summary().catch(() => this.sum);
    if (this.box?.isConnected) this.refresh();
  },

  count(code) { return this.sum?.countries.find((c) => c.code === code)?.artists.length || 0; },
  refresh() {
    const s = this.sum, box = this.box;
    if (!s || !box?.isConnected) return;
    const max = Math.max(1, ...s.countries.map((c) => c.artists.length));
    const level = (n) => (!n ? 0 : max <= 1 ? 2 : 1 + Math.round(3 * Math.log(n) / Math.log(max)));
    (this.paths || []).forEach(([el, c]) => {
      const n = this.count(c.code);
      el.setAttribute('class', `gl-c gl-l${level(n)}${this.sel === c.code ? ' on' : ''}`);
      el.firstChild.textContent = `${this.name(c.code) || c.name}${n ? ` · ${plural(n, 'artist')}` : ''}`;
    });
    const found = s.total - s.pending;
    $('.atlas-note', box).textContent = s.pending
      ? `Finding out where your artists are from: ${found.toLocaleString()} of ${s.total.toLocaleString()} so far. MusicBrainz answers about one a second; this happens once and carries on whenever Maré is open.`
      : `${s.countries.length} ${s.countries.length === 1 ? 'country' : 'countries'} · ${plural(s.total - s.unknown.length, 'artist')} placed${s.unknown.length ? ` · ${s.unknown.length} not found on MusicBrainz` : ''}. Drag the globe, or pick a country.`;
    if (!this.sel && s.countries.length) this.sel = s.countries[0].code;
    this.side();
  },
  side() {
    const s = this.sum, side = $('.atlas-side', this.box);
    if (!side) return;
    const rows = s.countries.concat(s.unknown.length ? [{ code: '-', artists: s.unknown }] : []);
    const cur = rows.find((c) => c.code === this.sel);
    const shown = this.all ? rows : rows.slice(0, 8);
    const chips = (cur?.artists || []).slice().sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0) || a.name.localeCompare(b.name));
    side.innerHTML = `${cur ? `<div class="atlas-sel"><span class="label">${cur.code === '-' ? 'Not placed' : 'Selected'}</span>
        <h3 class="cond">${esc(this.name(cur.code))}</h3><p class="atlas-n">${plural(cur.artists.length, 'artist')}</p>
        ${cur.code === '-' ? `<p class="section-note">MusicBrainz has no country for these, or doesn't know them under this name. <button class="btn btn-link" data-act="atlas-retry">Try them again</button></p>` : ''}
        <div class="chips">${chips.slice(0, 40).map((a) => `<a class="chip" href="#/artist/${esc(a.id)}">${esc(a.name)}</a>`).join('')}${chips.length > 40 ? `<span class="chip chip-more">and ${chips.length - 40} more</span>` : ''}</div></div>` : ''}
      <div class="atlas-rank">${shown.map((c, i) => `<button class="atlas-row${c.code === this.sel ? ' on' : ''}" data-act="atlas-pick" data-c="${esc(c.code)}">
          <span class="atlas-no">${c.code === '-' ? '' : i + 1}</span><span class="atlas-name">${esc(this.name(c.code))}</span><span class="atlas-count">${c.artists.length}</span></button>`).join('')}
        ${rows.length > 8 ? `<button class="btn btn-link" data-act="atlas-all">${this.all ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''}</div>`;
  },

  // ----- the globe: an SVG redrawn as it turns -----
  globe(host) {
    const G = this.lib, S = this.SIZE, ns = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs) => { const e = document.createElementNS(ns, tag); Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v)); return e; };
    const svg = el('svg', { class: 'globe', viewBox: `0 0 ${S} ${S}`, role: 'img', 'aria-label': 'Globe of your artists by country' });
    svg.appendChild(el('circle', { class: 'gl-sea', cx: S / 2, cy: S / 2, r: this.R }));
    const grat = svg.appendChild(el('path', { class: 'gl-grat' }));
    const land = svg.appendChild(el('g', {}));
    this.paths = G.countries.map((c) => {
      const p = land.appendChild(el('path', { class: 'gl-c', 'data-c': c.code }));
      p.appendChild(el('title'));
      return [p, c];
    });
    svg.appendChild(el('circle', { class: 'gl-rim', cx: S / 2, cy: S / 2, r: this.R }));
    host.textContent = ''; host.appendChild(svg);
    this.svg = svg; this.grat = grat;
    this.draw();

    // Drag to turn. On touch screens a sideways drag turns the globe and an up/down drag still scrolls the page.
    let drag = null;
    svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0, rot: this.rot.slice(), t: e.target }; this.spin = false; try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
    svg.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const k = (S / (svg.clientWidth || S)) * (180 / (Math.PI * this.R)), dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      this.rot = [drag.rot[0] + dx * k, Math.max(-80, Math.min(80, drag.rot[1] - dy * k))];
      this.schedule();
    });
    const end = (e) => {
      if (!drag) return;
      const d = drag; drag = null;
      const code = d.t?.getAttribute?.('data-c');
      if (e.type === 'pointerup' && d.moved < 6 && code && this.count(code)) this.pick(code);
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    if (this.spin) this.turn();
  },
  draw() {
    const G = this.lib, S = this.SIZE;
    const path = G.geoPath(G.geoOrthographic().scale(this.R).translate([S / 2, S / 2]).rotate(this.rot).clipAngle(90));
    this.paths.forEach(([el, c]) => el.setAttribute('d', path(c.geo) || ''));
    this.grat.setAttribute('d', path(G.geoGraticule10()) || '');
  },
  schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.svg?.isConnected) this.draw(); }); },
  // Turns slowly by itself until it is touched.
  turn() {
    let last = performance.now();
    const step = (t) => {
      if (!this.spin || !this.svg?.isConnected) return;
      if (!document.hidden) { this.rot = [this.rot[0] + (t - last) * 0.006, this.rot[1]]; this.draw(); }
      last = t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  },
  // Select a country (from the globe or the list) and turn the globe to face it.
  pick(code) {
    this.sel = code; this.spin = false;
    this.refresh();
    const c = this.lib?.countries.find((x) => x.code === code);
    if (!c || !this.svg?.isConnected) return;
    const [lon, lat] = this.lib.geoCentroid(c.geo), from = this.rot.slice();
    const to = [-lon, Math.max(-60, Math.min(60, -lat))];
    let d0 = ((to[0] - from[0]) % 360 + 540) % 360 - 180;   // the short way round
    const t0 = performance.now();
    const go = (t) => {
      const k = Math.min(1, (t - t0) / 600), e = 1 - (1 - k) ** 3;
      this.rot = [from[0] + d0 * e, from[1] + (to[1] - from[1]) * e];
      if (this.svg?.isConnected) this.draw();
      if (k < 1 && this.sel === code) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  },
};

Object.assign(actions, {
  'atlas-pick': (el) => Atlas.pick(el.dataset.c),
  'atlas-all': () => { Atlas.all = !Atlas.all; Atlas.side(); },
  'atlas-retry': () => { toast('Asking MusicBrainz again…'); Atlas.sel = null; Geo.retry(() => Atlas.onProgress()); Atlas.onProgress(); },
});

window.Geo = Geo;
window.Atlas = Atlas;
