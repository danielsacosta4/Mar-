/* Maré — Round 4: the collection (library quality index, labels, spec sheets, Collection page) and star ratings.
   Loaded after extras.js; uses and wraps its bindings the same way. */
'use strict';

Object.assign(STROKE, {
  star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.6l6.1-.8z"/>',
  bars: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
});
FILL.starFill = '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6L3.2 9.6l6.1-.8z"/>';

const khz = (hz) => +(hz / 1000).toFixed(1);
const fmtSize = (bytes) => {
  if (!bytes) return '';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(gb >= 100 ? 0 : 1)} GB` : `${Math.round(bytes / 1e6)} MB`;
};
const hasGain = (s) => !!s.replayGain && (s.replayGain.trackGain != null || s.replayGain.albumGain != null);
const isLossless = (s) => qualityOf(s)?.cls !== 'lossy';

/* ================= Catalog: a small summary of every album's files ================= */
// Navidrome only reports quality per song, so Maré reads the song list once (500 at a time), keeps a summary per
// album in localStorage and reads again only after Navidrome has rescanned the library (or after a week).

const RATED_KEEP = ['id', 'title', 'artist', 'artistId', 'album', 'albumId', 'coverArt', 'duration', 'track', 'discNumber', 'year', 'genre',
  'suffix', 'bitRate', 'bitDepth', 'samplingRate', 'replayGain', 'starred', 'userRating'];

const Catalog = {
  data: null,
  building: null,
  progress: null,          // { done, total } while reading
  load() {
    if (!this.data) {
      const d = store.get('catalog');
      this.data = d && d.v === 1 ? d : null;
    }
    return this.data;
  },
  save() { store.set('catalog', this.data); },
  album(id) { return this.load()?.albums[id] || null; },

  // Read again when Navidrome's last scan changed, or once a week.
  async ensure() {
    if (this.building) return this.building;
    const st = await API.call('getScanStatus').then((r) => r.scanStatus || {}).catch(() => null);
    const d = this.load();
    if (st?.scanning) return d;
    const stale = !d || (st && st.lastScan && st.lastScan !== d.scan) || Date.now() - d.at > 7 * 24 * HOUR;
    return stale ? this.build(st) : d;
  },

  build(st) {
    this.building = (async () => {
      const albums = {}, rated = [];
      const size = 500;
      let offset = 0, total = 0;
      this.progress = { done: 0, total: st?.count || 0 };
      UI.collectionTick?.();
      for (;;) {
        const r = await API.call('search3', { query: '', songCount: size, songOffset: offset, albumCount: 0, artistCount: 0 });
        const songs = r.searchResult3?.song || [];
        for (const s of songs) {
          if (!s.albumId) continue;
          // [name, artist, cover, fmt, dMin, dMax, rMin, rMax, kbps·sec, secs, bytes, songs, tagged, lossy, rating]
          const a = albums[s.albumId] || (albums[s.albumId] = [s.album || '', s.displayAlbumArtist || s.artist || '', s.coverArt || s.albumId, '', 99, 0, 1e9, 0, 0, 0, 0, 0, 0, 0, 0]);
          const fmt = String(s.suffix || '').toUpperCase();
          if (fmt && !a[3].split('/').includes(fmt)) a[3] = a[3] ? a[3] + '/' + fmt : fmt;
          if (s.bitDepth) { a[4] = Math.min(a[4], s.bitDepth); a[5] = Math.max(a[5], s.bitDepth); }
          if (s.samplingRate) { a[6] = Math.min(a[6], s.samplingRate); a[7] = Math.max(a[7], s.samplingRate); }
          const sec = s.duration || 0;
          a[8] += (s.bitRate || 0) * sec; a[9] += sec;
          a[10] += s.size || 0; a[11]++;
          if (hasGain(s)) a[12]++;
          if (!isLossless(s)) a[13]++;
          if (s.userRating) rated.push(Object.fromEntries(RATED_KEEP.filter((k) => s[k] != null).map((k) => [k, s[k]])));
        }
        total += songs.length;
        offset += songs.length;
        this.progress = { done: total, total: Math.max(total, st?.count || 0) };
        UI.collectionTick?.();
        if (songs.length < size) break;
      }
      for (const a of Object.values(albums)) { if (a[4] === 99) a[4] = 0; if (a[6] === 1e9) a[6] = 0; }
      this.data = { v: 1, at: Date.now(), scan: st?.lastScan || '', songs: total, albums, rated };
      this.save();
      return this.data;
    })().finally(() => { this.building = null; this.progress = null; this.paint(); UI.collectionTick?.(); });
    return this.building;
  },

  // What a card shows: "24/96" + "FLAC", or "320k" + "MP3".
  label(id) {
    const a = this.album(id);
    if (!a || !a[11]) return null;
    const lossy = a[13] === a[11];
    const fmt = a[3].split('/')[0] || '';
    if (lossy) return { res: a[9] ? `${Math.round(a[8] / a[9])}k` : '', fmt, cls: 'lossy' };
    const hires = a[5] > 16 || a[7] > 48000;
    const res = a[5] && a[7] ? `${a[5]}/${khz(a[7])}` : a[7] ? `${khz(a[7])} kHz` : '';
    return { res, fmt, cls: hires ? 'hires' : 'lossless' };
  },
  tags(id) {
    const l = this.label(id);
    return l ? `${l.res ? `<span class="qtag ${l.cls}">${esc(l.res)}</span>` : ''}${l.fmt ? `<span class="qtag">${esc(l.fmt)}</span>` : ''}` : '';
  },
  // Fill the labels under cards that were drawn before the catalog was ready.
  paint(root = document) {
    if (!this.load()) return;
    $$('.qtags[data-qa]:empty', root).forEach((el) => { el.innerHTML = this.tags(el.dataset.qa); });
  },

  // Buckets for the Collection page (by each album's best resolution).
  bucket(a) {
    if (a[13] === a[11]) return 'lossy';
    if (a[7] > 96000) return 'b192';
    if (a[7] > 48000) return 'b96';
    if (a[5] > 16) return 'b48';
    return 'cd';
  },

  setRating(song, n) {
    const d = this.load();
    if (!d) return;
    d.rated = d.rated.filter((x) => x.id !== song.id);
    if (n) d.rated.push({ ...Object.fromEntries(RATED_KEEP.filter((k) => song[k] != null).map((k) => [k, song[k]])), userRating: n });
    this.save();
  },
};

/* ================= Album labels on cards ================= */

const qtagsHtml = (id) => `<div class="qtags" data-qa="${esc(id)}">${Catalog.load() ? Catalog.tags(id) : ''}</div>`;
// eslint-disable-next-line no-func-assign
albumCard = ((orig) => function (a) { return orig(a).replace(/<\/a>\s*$/, `${qtagsHtml(a.id)}</a>`); })(albumCard);
// eslint-disable-next-line no-func-assign
discCard = ((orig) => function (a) { return orig(a).replace(/<\/a>\s*$/, `${qtagsHtml(a.id)}</a>`); })(discCard);

/* ================= Spec sheet on album pages ================= */

function specSheet(songs) {
  if (!songs.length) return '';
  const rows = [];
  const fmts = [...new Set(songs.map((s) => qualityOf(s)?.cls === 'lossless' && String(s.suffix).toLowerCase() === 'm4a' ? 'ALAC' : String(s.suffix || '').toUpperCase()).filter(Boolean))];
  if (fmts.length) rows.push(['Format', fmts.join(', ')]);
  const ds = songs.map((s) => s.bitDepth).filter(Boolean), rs = songs.map((s) => s.samplingRate).filter(Boolean);
  const range = (arr, f) => { const lo = Math.min(...arr), hi = Math.max(...arr); return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`; };
  if (ds.length || rs.length) rows.push(['Resolution', [ds.length && range(ds, (v) => v) + '-bit', rs.length && range(rs, khz) + ' kHz'].filter(Boolean).join(' / ')]);
  const secs = songs.reduce((t, s) => t + (s.bitRate ? s.duration || 0 : 0), 0);
  if (secs) rows.push(['Bitrate', `${Math.round(songs.reduce((t, s) => t + (s.bitRate || 0) * (s.duration || 0), 0) / secs).toLocaleString()} kbps average`]);
  const bytes = songs.reduce((t, s) => t + (s.size || 0), 0);
  if (bytes) rows.push(['Size', fmtSize(bytes)]);
  const tagged = songs.filter(hasGain).length;
  rows.push(['Volume tags', tagged === songs.length ? 'Tagged' : tagged ? `Partly tagged (${tagged} of ${songs.length})` : 'Not tagged', tagged < songs.length]);
  const spec = qualitySpec(Prefs.get('quality'));
  const conv = spec && songs.some((s) => Player.transcodes(s));
  rows.push(['You hear', conv ? `Converted to ${specName(spec)} kbps (streaming setting)` : 'The original files, untouched']);
  return `<section class="spec"><div class="label">Your copy</div><dl>${rows.map(([k, v, warn]) =>
    `<div><dt>${esc(k)}</dt><dd${warn ? ' class="warn"' : ''}>${esc(v)}</dd></div>`).join('')}</dl></section>`;
}

/* ================= Ratings ================= */

const Rating = {
  stars(n, attrs) {
    return `<span class="stars" role="group" aria-label="Rating" ${attrs}>${[1, 2, 3, 4, 5].map((k) =>
      `<button class="star${k <= n ? ' on' : ''}" data-act="rate" data-n="${k}" aria-label="${k} star${k > 1 ? 's' : ''}">${icon(k <= n ? 'starFill' : 'star')}</button>`).join('')}</span>`;
  },
  text: (n) => n ? '★'.repeat(n) : '',

  async set(kind, id, n) {
    await API.call('setRating', { id, rating: n });
    API.bust();
    if (kind === 'song') {
      const s = Songs.get(id);
      if (s) { s.userRating = n || undefined; Catalog.setRating(s, n); }
      $$(`.track[data-song="${CSS.escape(id)}"] .t-rating`).forEach((el) => { el.textContent = Rating.text(n); });
    }
    $$(`.stars[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`).forEach((el) => { el.outerHTML = Rating.stars(n, `data-kind="${kind}" data-id="${esc(id)}"`); });
    if (kind === 'song' && Player.current()?.id === id) Rating.syncNP();
    toast(n ? `Rated ${'★'.repeat(n)}` : 'Rating removed');
  },

  // Stars for the playing song: under the title in Now Playing and in the player bar.
  syncNP() {
    const s = Player.current();
    if (!$('.np-rate')) $('.np-text')?.insertAdjacentHTML('beforeend', '<div class="np-rate"></div>');
    const key = s ? `${s.id}:${s.userRating || 0}` : '';
    $$('.np-rate, .p-rate').forEach((box) => {
      if (box.dataset.key === key) return;
      box.dataset.key = key;
      box.innerHTML = s ? Rating.stars(s.userRating || 0, `data-kind="song" data-id="${esc(s.id)}"`) : '';
    });
  },
};

Object.assign(actions, {
  rate: (el) => {
    const box = el.closest('.stars');
    const n = +el.dataset.n;
    const cur = box.querySelectorAll('.star.on').length;
    Menu.close();
    return Rating.set(box.dataset.kind, box.dataset.id, n === cur ? 0 : n);   // tapping the current rating clears it
  },
  'mix-top': async () => {
    const d = await Catalog.ensure();
    const rated = (d?.rated || []).slice();
    const best = rated.filter((s) => s.userRating === 5);
    const list = best.length >= 10 ? best : rated.filter((s) => s.userRating >= 4);
    if (!list.length) { toast('Rate some songs with 4 or 5 stars first'); return; }
    Player.playList(list, 0, { shuffle: true });
  },
});

// Song menu: a row of stars at the top.
{
  const prev = songMenu;
  // eslint-disable-next-line no-func-assign
  songMenu = function (anchor, s) {
    prev(anchor, s);
    $('#menu').insertAdjacentHTML('afterbegin', `<div class="menu-stars">${Rating.stars(s.userRating || 0, `data-kind="song" data-id="${esc(s.id)}"`)}</div><hr>`);
  };
}

// Now Playing: stars under the title.
{
  const sync = UI.syncPlayer.bind(UI);
  UI.syncPlayer = function () { sync(); Rating.syncNP(); };
}

// Keys 1–5 rate the song that's playing; 0 clears.
document.addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  const s = Player.current();
  if (!s || !/^[0-5]$/.test(e.key)) return;
  run(() => Rating.set('song', s.id, +e.key));
});

/* ================= Right-click (and long-press) menus ================= */
// The same menus as the "…" buttons, opened where you clicked. Albums, artists and playlists get their own.

function menuAt(x, y) {
  const m = $('#menu');
  if (m.hidden) return;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(x, innerWidth - w - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - h - 8)) + 'px';
}
const starsRow = (kind, id, n) => `<div class="menu-stars">${Rating.stars(n, `data-kind="${kind}" data-id="${esc(id)}"`)}</div><hr>`;

const CardMenus = {
  async album(el, id) {
    const songs = () => albumSongs(id).then((x) => x.songs);
    Menu.open(el, [
      { key: 'play', label: 'Play', icon: 'play', run: async () => Player.playList(await songs(), 0, { shuffle: false }) },
      { key: 'shuffle', label: 'Shuffle', icon: 'shuffle', run: async () => Player.playList(await songs(), 0, { shuffle: true }) },
      '-',
      { key: 'next', label: 'Play Next', icon: 'playNext', run: async () => { Player.playNext(await songs()); toast('Album plays next'); } },
      { key: 'queue', label: 'Add to Queue', icon: 'addQueue', run: async () => { Player.addToQueue(await songs()); toast('Album added to queue'); } },
      { key: 'radio', label: 'Start Radio', icon: 'radio', run: async () => window.Radio.start('album', (await albumSongs(id)).album) },
      { key: 'addpl', label: 'Add to Playlist…', icon: 'playlist', run: async () => Playlists.addTo(await songs()) },
      '-',
      { key: 'dl', label: Offline.has('album:' + id) ? 'Downloaded' : 'Download', icon: 'download', run: () => Offline.has('album:' + id) ? toast('Already downloaded') : Offline.download('album', id) },
      { key: 'open', label: 'Go to Album', icon: 'album', run: () => { location.hash = '#/album/' + id; } },
    ]);
    $('#menu').insertAdjacentHTML('afterbegin', starsRow('album', id, 0));
    // The card doesn't know the rating; fill it in when the album answers.
    const a = await albumSongs(id).then((x) => x.album).catch(() => null);
    const box = $('#menu .menu-stars');
    if (a && box && !$('#menu').hidden) box.innerHTML = Rating.stars(a.userRating || 0, `data-kind="album" data-id="${esc(id)}"`);
  },
  artist(el, id) {
    Menu.open(el, [
      { key: 'shuffle', label: 'Shuffle', icon: 'shuffle', run: () => actions['play-artist']({ dataset: { id } }) },
      { key: 'radio', label: 'Start Radio', icon: 'radio', run: () => actions['radio-artist']({ dataset: { id } }) },
      { key: 'open', label: 'Go to Artist', icon: 'artist', run: () => { location.hash = '#/artist/' + id; } },
    ]);
  },
  playlist(el, id) {
    Menu.open(el, [
      { key: 'play', label: 'Play', icon: 'play', run: () => actions['play-playlist']({ dataset: { id } }) },
      { key: 'shuffle', label: 'Shuffle', icon: 'shuffle', run: () => actions['shuffle-playlist']({ dataset: { id } }) },
      { key: 'queue', label: 'Add to Queue', icon: 'addQueue', run: async () => { Player.addToQueue(await playlistSongs(id)); toast('Playlist added to queue'); } },
      { key: 'dl', label: Offline.has('playlist:' + id) ? 'Downloaded' : 'Download', icon: 'download', run: () => Offline.has('playlist:' + id) ? toast('Already downloaded') : Offline.download('playlist', id) },
      { key: 'open', label: 'Open Playlist', icon: 'playlist', run: () => { location.hash = '#/playlist/' + id; } },
    ]);
  },
};

// Returns true when it opened a menu for what's under the pointer.
function contextMenuFor(target, x, y) {
  let el;
  if ((el = target.closest('.track'))) {
    const more = $('.t-more', el);
    if (!more) return false;
    actions['menu-song'](more);
  } else if ((el = target.closest('.q-item'))) {
    const s = Player.queue[+el.dataset.i];
    if (!s) return false;
    songMenu(el, s);
  } else if ((el = target.closest('.p-now, .np-meta'))) {
    if (!Player.current()) return false;
    actions['menu-current'](el);
  } else if ((el = target.closest('.chart-row[data-song]'))) {
    const s = Songs.get(el.dataset.song);
    if (!s) return false;
    songMenu(el, s);
  } else if ((el = target.closest('a[href^="#/album/"]:is(.card, .chart-row, .art, .top-result)'))) {
    CardMenus.album(el, decodeURIComponent(el.getAttribute('href').split('/')[2]));
  } else if ((el = target.closest('a.card[href^="#/artist/"]'))) {
    CardMenus.artist(el, decodeURIComponent(el.getAttribute('href').split('/')[2]));
  } else if ((el = target.closest('a.card[href^="#/playlist/"]'))) {
    CardMenus.playlist(el, decodeURIComponent(el.getAttribute('href').split('/')[2]));
  } else return false;
  menuAt(x, y);
  return true;
}

document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea, #menu')) return;
  if (contextMenuFor(e.target, e.clientX, e.clientY)) e.preventDefault();
});

// Long-press on touch screens (iOS doesn't send contextmenu for links).
{
  let timer = null, start = null, fired = false;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
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
  const cancel = () => { clearTimeout(timer); start = null; };
  document.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener('touchend', (e) => { cancel(); if (fired) { e.preventDefault(); fired = false; } });
  document.addEventListener('touchcancel', cancel);
  // A long-press shouldn't also count as a tap.
  document.addEventListener('click', (e) => { if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; } }, true);
}

/* ================= Collection page ================= */

const BUCKETS = [['b192', '24-bit · above 96 kHz'], ['b96', '24-bit · 88.2–96 kHz'], ['b48', '24-bit · 44.1–48 kHz'], ['cd', 'CD quality · 16-bit'], ['lossy', 'Lossy (MP3, AAC…)']];
const FILTERS = {
  hires: ['Hi-res albums', (a) => Catalog.bucket(a).startsWith('b')],
  cd: ['CD-quality albums', (a) => Catalog.bucket(a) === 'cd'],
  lossy: ['Albums with lossy files', (a) => a[13] > 0],
  untagged: ['Albums missing volume tags', (a) => a[12] < a[11]],
  ...Object.fromEntries(BUCKETS.map(([k, l]) => [k, [l, (a) => Catalog.bucket(a) === k]])),
};

View.collection = async (main, params, filter) => {
  const draw = () => {
    if (UI.route.name !== 'collection') return;
    const d = Catalog.load();
    const p = Catalog.progress;
    const reading = p ? `<p class="section-note" id="coll-progress">Reading your library… ${p.done.toLocaleString()}${p.total ? ` of ${p.total.toLocaleString()}` : ''} songs</p>` : '';
    if (filter && FILTERS[filter] && d) {
      const [title, test] = FILTERS[filter];
      const list = Object.entries(d.albums).filter(([, a]) => test(a))
        .map(([id, a]) => ({ id, name: a[0], artist: a[1], coverArt: a[2] }))
        .sort((x, y) => x.artist.localeCompare(y.artist) || x.name.localeCompare(y.name));
      main.innerHTML = `<div class="page-head"><h1 class="page-title">${esc(title)}</h1><a class="btn" href="#/collection">${icon('bars')}Collection</a></div>
        ${filter === 'untagged' && list.length ? '<p class="section-note">These albums play without volume levelling. Adding ReplayGain tags (for example with rsgain on the server) fixes that.</p>' : ''}
        ${list.length ? grid(list) : '<div class="empty"><h3>None</h3><p>Nothing in your library matches.</p></div>'}`;
      return;
    }
    if (!d) {
      main.innerHTML = `<h1 class="page-title">Collection</h1>${reading || '<p class="section-note">Reading your library…</p>'}`;
      return;
    }
    const all = Object.values(d.albums).filter((a) => a[11]);
    const n = all.length || 1;
    const count = (f) => all.filter(FILTERS[f][1]).length;
    const hires = count('hires'), cd = count('cd'), lossy = count('lossy'), untagged = count('untagged');
    const bytes = all.reduce((t, a) => t + a[10], 0);
    const per = BUCKETS.map(([k, l]) => [k, l, all.filter((a) => Catalog.bucket(a) === k).length]);
    const max = Math.max(1, ...per.map((x) => x[2]));
    const pct = (v) => `${Math.round((v / n) * 100)}%`;
    main.innerHTML = `<h1 class="page-title">Collection</h1>
      ${reading}
      <div class="tiles">
        <a class="tile" href="#/collection/hires"><span class="label">Hi-res albums</span><b>${hires.toLocaleString()}</b><span>${pct(hires)} of your albums</span></a>
        <a class="tile" href="#/collection/cd"><span class="label">CD quality</span><b>${cd.toLocaleString()}</b><span>${pct(cd)}</span></a>
        <a class="tile" href="#/collection/lossy"><span class="label">Lossy files</span><b>${lossy.toLocaleString()}</b><span>${lossy ? 'albums with MP3, AAC or similar' : 'none, all lossless'}</span></a>
        <a class="tile${untagged ? ' warn' : ''}" href="#/collection/untagged"><span class="label">Volume tags</span><b>${untagged ? untagged.toLocaleString() : 'All'}</b><span>${untagged ? `albums missing them (${pct(untagged)})` : 'every album is tagged'}</span></a>
      </div>
      ${section('By resolution', `<div class="res-bars">${per.map(([k, l, v]) => `<a class="res-row" href="#/collection/${k}">
          <span class="res-label">${esc(l)}</span><span class="res-bar"><i style="width:${(v / max) * 100}%"></i></span><span class="res-n">${v.toLocaleString()}</span></a>`).join('')}</div>`)}
      <p class="coll-foot">${all.length.toLocaleString()} albums · ${d.songs.toLocaleString()} songs${bytes ? ` · ${fmtSize(bytes)}` : ''} · read ${esc(new Date(d.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))}
        <button class="btn btn-link" data-act="coll-reread">Read again</button></p>
      <div id="coll-rated"></div>`;
    const top = (d.rated || []).filter((s) => s.userRating >= 4).sort((x, y) => y.userRating - x.userRating).slice(0, 20);
    if (top.length) {
      $('#coll-rated').innerHTML = `<section class="section"><div class="section-head"><h2>Your Top Rated Songs</h2><a href="#" data-act="mix-top">Play your 5-star songs</a></div>${trackRows(register(top), { art: true, numbers: 'index' })}</section>`;
      markPlaying();
    }
  };
  UI.collectionTick = draw;   // redraw as the reading progresses
  draw();
  if (!Catalog.building) Catalog.ensure().then(draw).catch((e) => toast(e.message));
};
actions['coll-reread'] = async () => { await Catalog.build(await API.call('getScanStatus').then((r) => r.scanStatus).catch(() => null)); };

// Navigation: Collection under Library.
{
  const nav = $('.side-nav');
  if (nav && !$('[data-nav="collection"]', nav)) {
    const after = $('[data-nav="playlists"]', nav);
    after?.insertAdjacentHTML('afterend', `<a href="#/collection" data-nav="collection"><span class="ico">${icon('bars')}</span>Collection</a>`);
  }
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const links = $('.lib-links', main);
    if (links && !$('[href="#/collection"]', links)) $('[href="#/playlists"]', links)?.insertAdjacentHTML('afterend', `<a href="#/collection"><span class="ico">${icon('bars')}</span>Collection</a>`);
    return p;
  };
}

window.Catalog = Catalog;
window.Rating = Rating;
