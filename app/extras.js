/* Maré — Round 3: quality badges, playlist editing, drag to reorder, downloads, big-library speed. Loaded last. */
'use strict';

Object.assign(STROKE, {
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke-width="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  cloudOff: '<path d="m3 3 18 18"/><path d="M17.5 17.5H7a4.5 4.5 0 0 1-1.1-8.9M9.5 5.6A6 6 0 0 1 19 10a4 4 0 0 1 1.7 6.9"/>',
});

/* ================= Sheets (dialogs) ================= */

const Sheet = {
  open({ title, body = '', ok = 'OK', cancel = 'Cancel', danger = false, input, onOk }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'sheet-wrap';
      wrap.innerHTML = `<form class="sheet" role="dialog" aria-modal="true">
          <h2>${esc(title)}</h2>${body}
          ${input ? `<label>${esc(input.label)}<input name="v" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" autocomplete="off"></label>` : ''}
          <p class="sheet-error" role="alert"></p>
          <div class="sheet-actions"><button type="button" class="btn btn-ghost" data-close>${esc(cancel)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="submit">${esc(ok)}</button></div></form>`;
      document.body.appendChild(wrap);
      const f = $('form', wrap);
      const done = (v) => { wrap.remove(); resolve(v); };
      $('[data-close]', wrap).onclick = () => done(null);
      wrap.addEventListener('click', (e) => { if (e.target === wrap) done(null); });
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
      f.onsubmit = async (e) => {
        e.preventDefault();
        const v = input ? f.v.value.trim() : true;
        if (input && !v) { $('.sheet-error', f).textContent = `${input.label} can't be empty.`; return; }
        if (onOk) {
          const btn = $('button[type="submit"]', f); btn.disabled = true;
          try { await onOk(v); } catch (err) { $('.sheet-error', f).textContent = err.message; btn.disabled = false; return; }
        }
        done(v);
      };
      setTimeout(() => (input ? f.v : $('button[type="submit"]', f)).focus(), 30);
      wrap._form = f;
    });
  },
};

/* ================= Quality badges ================= */

const LOSSLESS = new Set(['flac', 'alac', 'wav', 'aif', 'aiff', 'ape', 'wv', 'dsf', 'dff', 'tta']);
function qualityOf(s) {
  if (!s) return null;
  const suf = String(s.suffix || '').toLowerCase();
  const lossless = LOSSLESS.has(suf) || (suf === 'm4a' && s.bitDepth > 0 && s.bitRate > 500);
  const sr = s.samplingRate || 0, bd = s.bitDepth || 0;
  const fmt = suf === 'm4a' && lossless ? 'ALAC' : suf.toUpperCase();
  const detail = [fmt, bd && sr ? `${bd}-bit/${+(sr / 1000).toFixed(1)} kHz` : sr ? `${+(sr / 1000).toFixed(1)} kHz` : '', s.bitRate ? `${s.bitRate.toLocaleString()} kbps` : '']
    .filter(Boolean).join(' · ');
  if (lossless && (bd > 16 || sr > 48000)) return { label: 'Hi-Res Lossless', cls: 'hires', detail };
  if (lossless) return { label: 'Lossless', cls: 'lossless', detail };
  return { label: s.bitRate ? `${fmt} ${s.bitRate}` : fmt, cls: 'lossy', detail };
}
const badgeInner = (q) => `${q.cls !== 'lossy' ? '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h2M4 2v6M7 3.5v3M10 1v8M13 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>' : ''}${esc(q.label)}`;
const badge = (q, extra = '') => q ? `<span class="qbadge ${q.cls}"${extra}>${badgeInner(q)}</span>` : '';

function albumQuality(songs) {
  const qs = songs.map(qualityOf).filter(Boolean);
  if (!qs.length) return null;
  if (qs.some((q) => q.cls === 'hires')) return { ...qs.find((q) => q.cls === 'hires'), label: 'Hi-Res Lossless' };
  if (qs.every((q) => q.cls === 'lossless')) return qs[0];
  return null;
}

// What you're hearing, in the player bar and Now Playing: "FLAC 24/96", or "Opus 128 · from FLAC 24/96" when converting.
const fileLabel = (s) => {
  const fmt = String(s.suffix || '').toUpperCase();
  if (s.bitDepth && s.samplingRate) return `${fmt} ${s.bitDepth}/${+(s.samplingRate / 1000).toFixed(1)}`;
  return s.bitRate ? `${fmt} ${s.bitRate}` : fmt;
};
const Quality = {
  sync(s) {
    const q = qualityOf(s);
    const spec = qualitySpec(Prefs.get('quality'));
    const conv = !!s && Player.transcodes(s);
    const offline = s && Offline.hasSong(s.id);
    $$('.np-quality, .p-quality').forEach((el) => {
      if (!q) { el.hidden = true; return; }
      el.hidden = false;
      const base = el.classList.contains('np-quality') ? 'np-quality' : 'p-quality';
      el.className = `${base} qbadge ${conv ? 'lossy conv' : q.cls}`;
      el.innerHTML = conv ? esc(`${specName(spec)} · from ${fileLabel(s)}`) : `${badgeInner({ ...q, label: fileLabel(s) })}${offline ? ' · downloaded' : ''}`;
      el.title = conv ? `Converted to ${specName(spec)} kbps from the original (${q.detail}). Click to change.` : `${q.detail}. Click to change the streaming quality.`;
    });
  },
  // Quick picker; changing it applies to the song that's playing straight away.
  pick(anchor) {
    const cur = Prefs.get('quality');
    const s = Player.current();
    const opts = [['original', `Original${s ? ` (${fileLabel(s)})` : ''}`], ['opus128', 'Opus 128 kbps'], ['opus96', 'Opus 96 kbps'],
      ['high', 'MP3 320 kbps'], ['normal', 'MP3 192 kbps'], ['low', 'MP3 128 kbps']];
    Menu.open(anchor, opts.map(([k, l]) => ({ key: 'q-' + k, label: `${k === cur ? '✓ ' : '\u2003 '}${l}`, run: () => {
      Player.setQuality(k);
      toast(k === 'original' ? 'Playing the original files' : `Streaming as ${specName(qualitySpec(k))} kbps`);
    } })));
  },
};

/* ================= Playlists ================= */

const Playlists = {
  async mine() {
    const r = await API.call('getPlaylists', {}, { cache: MIN });
    return (r.playlists?.playlist || []).filter((p) => p.owner === API.user && !p.readonly);
  },
  refresh() { API.bust(); UI.loadSidebarPlaylists(); },

  async create(name, songIds = []) {
    const r = await API.call('createPlaylist', { name, songId: songIds });
    this.refresh();
    return r.playlist;
  },

  async addTo(songs) {
    songs = (Array.isArray(songs) ? songs : [songs]).filter(Boolean);
    if (!songs.length) return;
    const list = await this.mine();
    const n = songs.length === 1 ? `“${songs[0].title}”` : plural(songs.length, 'song');
    const body = `<p>Add ${esc(n)} to:</p><div class="pl-pick">
      <button type="button" class="pl-opt pl-new" data-new>${icon('plus')}<span>New Playlist…</span></button>
      ${list.map((p) => `<button type="button" class="pl-opt" data-pl="${esc(p.id)}">${p.coverArt ? `<img src="${esc(API.cover(p.coverArt, 80))}" alt="">` : `<span class="pl-ph">${icon('playlist')}</span>`}<span>${esc(p.name)}<small>${plural(p.songCount || 0, 'song')}</small></span></button>`).join('')}
    </div>`;
    const sheet = Sheet.open({ title: 'Add to Playlist', body, ok: 'Done', cancel: 'Cancel' });
    const wrap = $$('.sheet-wrap').pop();
    $('button[type="submit"]', wrap).hidden = true;
    wrap.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pl], [data-new]');
      if (!b) return;
      wrap.remove();
      try {
        if (b.dataset.new !== undefined) {
          const name = await Sheet.open({ title: 'New Playlist', input: { label: 'Name', placeholder: 'My playlist' }, ok: 'Create',
            onOk: (v) => this.create(v, songs.map((s) => s.id)) });
          if (name) toast(`Created “${name}”`);
        } else {
          // Skip songs the playlist already has (and repeats within the selection).
          const name = list.find((p) => p.id === b.dataset.pl)?.name || 'playlist';
          const have = new Set(((await API.call('getPlaylist', { id: b.dataset.pl })).playlist?.entry || []).map((e) => e.id));
          const fresh = songs.filter((s) => !have.has(s.id) && have.add(s.id));
          const dup = songs.length - fresh.length;
          if (!fresh.length) { toast(songs.length === 1 ? `“${songs[0].title}” is already in ${name}` : `Those songs are already in ${name}`); return; }
          await API.call('updatePlaylist', { playlistId: b.dataset.pl, songIdToAdd: fresh.map((s) => s.id) });
          this.refresh();
          toast(dup ? `Added ${plural(fresh.length, 'song')} to ${name}. ${dup} already there.` : `Added to ${name}`);
        }
      } catch (err) { toast(err.message); }
    });
    return sheet;
  },

  async rename(p) {
    const name = await Sheet.open({ title: 'Rename Playlist', input: { label: 'Name', value: p.name }, ok: 'Rename',
      onOk: (v) => API.call('updatePlaylist', { playlistId: p.id, name: v }) });
    if (name) { this.refresh(); toast('Playlist renamed'); UI.render(); }
  },

  async remove(p) {
    const ok = await Sheet.open({ title: `Delete “${p.name}”?`, body: '<p>The playlist is deleted from Navidrome. The songs stay in your library.</p>',
      ok: 'Delete', danger: true, onOk: () => API.call('deletePlaylist', { id: p.id }) });
    if (ok) { this.refresh(); toast('Playlist deleted'); location.hash = '#/playlists'; }
  },

  async setOrder(id, songIds) {
    await API.call('createPlaylist', { playlistId: id, songId: songIds });
    API.bust();
  },

  async removeIndex(id, i) {
    await API.call('updatePlaylist', { playlistId: id, songIndexToRemove: i });
    this.refresh();
  },
};

/* ================= Drag to reorder ================= */

function sortable(container, { item, handle, scroller, canDrop = () => true, onDrop }) {
  // iOS: keep a finger on the grip from scrolling the page instead of dragging the row.
  container.addEventListener('touchstart', (e) => { if (e.target.closest(handle)) e.preventDefault(); }, { passive: false });
  container.addEventListener('pointerdown', (e) => {
    const h = e.target.closest(handle);
    if (!h || !container.contains(h) || e.button > 0) return;
    const el = h.closest(item);
    const items = $$(item, container);
    const from = items.indexOf(el);
    if (from < 0) return;
    e.preventDefault();
    const sc = scroller || container;
    const rects = items.map((x) => x.getBoundingClientRect());
    const startY = e.clientY, startScroll = sc.scrollTop, hgt = rects[from].height;
    let to = from, lastY = e.clientY, raf = 0;
    UI.dragging = true;
    el.classList.add('dragging');
    container.classList.add('is-sorting');
    h.setPointerCapture(e.pointerId);
    const update = () => {
      const dScroll = sc.scrollTop - startScroll;
      const dy = lastY - startY + dScroll;
      el.style.transform = `translateY(${dy}px)`;
      // Positions are compared in the coordinates of the drag start, with scrolling folded into dy.
      const y = rects[from].top + hgt / 2 + dy;
      let t = 0;
      rects.forEach((r, i) => { if (i !== from && r.top + r.height / 2 < y) t++; });
      while (t !== from && !canDrop(t) && t < items.length - 1) t++;
      to = canDrop(t) ? t : from;
      items.forEach((x, i) => {
        if (i === from) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -hgt;
        if (from > to && i >= to && i < from) shift = hgt;
        x.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const autoScroll = () => {
      const r = sc.getBoundingClientRect();
      const edge = 60;
      if (lastY < r.top + edge) sc.scrollTop -= 12; else if (lastY > r.bottom - edge) sc.scrollTop += 12;
      update();
      raf = requestAnimationFrame(autoScroll);
    };
    raf = requestAnimationFrame(autoScroll);
    const move = (ev) => { lastY = ev.clientY; };
    const up = () => {
      cancelAnimationFrame(raf);
      h.removeEventListener('pointermove', move);
      h.removeEventListener('pointerup', up);
      h.removeEventListener('pointercancel', up);
      items.forEach((x) => { x.style.transform = ''; });
      el.classList.remove('dragging');
      container.classList.remove('is-sorting');
      UI.dragging = false;
      // The release would otherwise count as a click on the row (play / jump).
      if (Math.abs(lastY - startY) > 4) {
        const stop = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
        window.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 300);
      }
      if (to !== from) onDrop(from, to);
    };
    h.addEventListener('pointermove', move);
    h.addEventListener('pointerup', up);
    h.addEventListener('pointercancel', up);
  });
}

/* ================= Offline downloads ================= */

const AUDIO_CACHE = 'mare-audio', ART_CACHE = 'mare-art';
const Offline = {
  offline: false,
  supported: 'serviceWorker' in navigator && window.isSecureContext && 'caches' in window,
  jobs: new Map(),

  // Read once and kept in memory: this is asked several times a second while playing (it used to parse the whole index each time).
  db() { return (this._db ||= store.get('downloads') || { items: {}, songs: {} }); },
  save(d) { this._db = d; store.set('downloads', d); },
  // Local copy to play instead of streaming: a download, or (only when the server can't be reached) a song saved ahead.
  // These URLs are answered by the service worker; online streams no longer pass through it at all.
  localUrl(id) {
    if (!navigator.serviceWorker?.controller) return '';
    if (this.hasSong(id)) return `/offline/song/${encodeURIComponent(id)}`;
    if ((this.offline || navigator.onLine === false) && window.Ahead?.has(id)) return `/ahead/${encodeURIComponent(id)}`;
    return '';
  },
  has(key) { return !!this.db().items[key]; },
  hasSong(id) { return !!this.db().songs[id]; },
  count() { return Object.keys(this.db().items).length; },
  songs() { return register(Object.values(this.db().songs)); },

  slim(s) {
    const keep = ['id', 'title', 'artist', 'artistId', 'album', 'albumId', 'coverArt', 'duration', 'track', 'discNumber', 'year', 'genre', 'suffix', 'bitRate', 'bitDepth', 'samplingRate', 'replayGain', 'starred'];
    return Object.fromEntries(keep.filter((k) => s[k] != null).map((k) => [k, s[k]]));
  },

  async register() {
    if (!this.supported) return;
    try { await navigator.serviceWorker.register('sw.js'); } catch { /* ignore */ }
  },

  async download(kind, id) {
    if (!this.supported) {
      Sheet.open({ title: 'Downloads need the secure address', body: '<p>Open Maré through its HTTPS address (the one you set up in NPMplus) to download music for offline listening. Browsers only allow offline storage on secure sites.</p>', ok: 'OK', cancel: 'Close' });
      return;
    }
    const key = `${kind}:${id}`;
    if (this.jobs.has(key)) { toast('Already downloading'); return; }
    this.jobs.set(key, { done: 0, total: 0, bytes: 0 });
    this.paint(key);
    toast('Starting download…');
    let name, artist = '', coverArt, songs;
    if (kind === 'album') { const r = await albumSongs(id); name = r.album.name; artist = r.album.artist; coverArt = r.album.coverArt; songs = r.songs; }
    else if (kind === 'playlist') { const r = await API.call('getPlaylist', { id }); name = r.playlist.name; coverArt = r.playlist.coverArt; songs = register(r.playlist.entry || []); }
    else { this.jobs.delete(key); return; }
    if (!songs.length) { this.jobs.delete(key); this.paint(key); return; }
    toast(`Downloading ${name} · ${songs.length} song${songs.length === 1 ? '' : 's'}. You can keep browsing.`);
    try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
    const job = { done: 0, total: songs.length, bytes: 0 };
    this.jobs.set(key, job);
    this.paint(key);
    const dq = qualitySpec(Prefs.get('dlQuality'));
    const audio = await caches.open(AUDIO_CACHE), art = await caches.open(ART_CACHE);
    const db = this.db();
    db.items[key] = { kind, id, name, artist, coverArt, songIds: songs.map((s) => s.id), date: Date.now(), partial: true };
    this.save(db);
    const covers = new Set([coverArt, ...songs.map((s) => s.coverArt)].filter(Boolean));
    await Promise.all([...covers].map(async (c) => {
      try { const r = await fetch(API.cover(c, 600)); if (r.ok) await art.put(`/offline/art/${c}`, r); } catch { /* ignore */ }
    }));
    let i = 0, failed = 0;
    const worker = async () => {
      while (i < songs.length) {
        const s = songs[i++];
        if (!(await audio.match(`/offline/song/${s.id}`))) {
          try {
            const r = await fetch(API.stream(s.id, dq ? { format: dq.format, maxBitRate: dq.kbps, estimateContentLength: true } : null));
            if (!r.ok) throw new Error(r.status);
            const blob = await r.blob();
            job.bytes += blob.size;
            await audio.put(`/offline/song/${s.id}`, new Response(blob, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'audio/mpeg', 'Content-Length': blob.size } }));
          } catch { failed++; job.done++; this.paint(key); continue; }
        }
        const d = this.db(); d.songs[s.id] = this.slim(s); this.save(d);
        job.done++; this.paint(key);
      }
    };
    await Promise.all([worker(), worker()]);
    const d = this.db();
    if (d.items[key]) { d.items[key].partial = failed > 0; d.items[key].bytes = (d.items[key].bytes || 0) + job.bytes; }
    this.save(d);
    this.jobs.delete(key);
    this.paint(key);
    toast(failed ? `Downloaded ${name} (${failed} song${failed === 1 ? '' : 's'} failed)` : `Downloaded ${name}`);
    if (UI.route.name === 'downloads') UI.render();
  },

  async removeItem(key) {
    const d = this.db();
    const it = d.items[key];
    if (!it) return;
    delete d.items[key];
    const still = new Set(Object.values(d.items).flatMap((x) => x.songIds));
    const audio = await caches.open(AUDIO_CACHE), art = await caches.open(ART_CACHE);
    for (const id of it.songIds) {
      if (still.has(id)) continue;
      await audio.delete(`/offline/song/${id}`);
      delete d.songs[id];
    }
    const covers = new Set(Object.values(d.items).map((x) => x.coverArt));
    if (it.coverArt && !covers.has(it.coverArt)) await art.delete(`/offline/art/${it.coverArt}`);
    this.save(d);
    this.paint(key);
    toast(`Removed ${it.name} from downloads`);
  },

  // Update every download button for this item.
  paint(key) {
    const job = this.jobs.get(key);
    const has = this.has(key);
    $$(`[data-dl="${CSS.escape(key)}"]`).forEach((b) => {
      b.classList.toggle('on', has && !job);
      b.innerHTML = job ? (job.total ? `<span class="dl-ring" style="--p:${Math.round((job.done / job.total) * 100)}%"></span>${job.done}/${job.total}` : `<span class="dl-ring" style="--p:0%"></span>Starting…`)
        : has ? `${icon('check')}Downloaded` : `${icon('download')}Download`;
      b.disabled = !!job;
    });
  },
  button(kind, id) {
    const key = `${kind}:${id}`;
    const b = `<button class="btn btn-dl" data-act="dl-toggle" data-dl="${esc(key)}"></button>`;
    setTimeout(() => this.paint(key));
    return b;
  },

  setOffline(v) {
    if (this.offline === v) return;
    this.offline = v;
    document.body.classList.toggle('is-offline', v);
    let bar = $('#offline-bar');
    if (v && !bar) {
      bar = document.createElement('div');
      bar.id = 'offline-bar'; bar.className = 'offline-bar';
      bar.innerHTML = `${icon('cloudOff')}<span>You're offline. Your downloads still play.</span><a href="#/downloads">Downloads</a><button class="ob-close" aria-label="Hide">×</button>`;
      $('.ob-close', bar).onclick = () => bar.remove();
      document.body.appendChild(bar);
    }
    // Keep checking quietly, so the notice goes away by itself once the server answers again.
    clearInterval(this._retry);
    if (v) this._retry = setInterval(() => API.call('ping').catch(() => {}), 15000);
    if (!v) { bar?.remove(); Player.flushScrobbles(); }
  },
};

View.downloads = async (main) => {
  const d = Offline.db();
  const items = Object.entries(d.items).sort((a, b) => b[1].date - a[1].date);
  let usage = '';
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage) usage = `${est.usage >= 1e9 ? (est.usage / 1e9).toFixed(est.usage > 1e10 ? 0 : 1) + ' GB' : Math.max(1, Math.round(est.usage / 1e6)) + ' MB'} used on this device`;
  } catch { /* ignore */ }
  const nSongs = Object.keys(d.songs).length;
  main.innerHTML = `<div class="page-head"><h1 class="page-title">Downloads</h1>
      ${nSongs ? `<div class="detail-actions"><button class="btn btn-primary" data-act="dl-shuffle">${icon('shuffle')}Shuffle downloads</button></div>` : ''}</div>
    <p class="section-note">${nSongs ? `${plural(nSongs, 'song')} ready offline${usage ? ` · ${usage}` : ''}` : ''}</p>
    ${!Offline.supported ? '<div class="lb-connect"><div><h3>Downloads need the secure address</h3><p>Open Maré through its HTTPS address to download music for offline listening.</p></div></div>' : ''}
    ${items.length ? `<div class="grid">${items.map(([key, it]) => `<div class="card dl-card">
        <a href="${it.kind === 'album' ? '#/album/' : '#/playlist/'}${esc(it.id)}" data-dl-open="${esc(key)}"><div class="art">${artImg(it.coverArt, 300)}
          <button class="art-play" data-act="dl-play" data-key="${esc(key)}" aria-label="Play ${esc(it.name)}">${icon('play')}</button></div>
          <div class="card-title">${esc(it.name)}</div></a>
        <div class="card-sub">${esc(it.artist || (it.kind === 'playlist' ? 'Playlist' : ''))} · ${plural(it.songIds.length, 'song')}${it.partial ? ' · incomplete' : ''}</div>
        <button class="dl-remove" data-act="dl-remove" data-key="${esc(key)}">${icon('trash')}Remove</button>
      </div>`).join('')}</div>`
      : `<div class="empty"><h3>Nothing downloaded yet</h3><p>Use the Download button on any album or playlist to keep it on this device.</p></div>`}`;
};

/* Offline: albums and playlists open from the download list instead of the server. */
function offlineItemView(main, key) {
  const it = Offline.db().items[key];
  if (!it) return false;
  const songs = it.songIds.map((id) => Offline.db().songs[id]).filter(Boolean);
  main.innerHTML = `<header class="detail"><div class="art">${artImg(it.coverArt, 600)}</div><div>
      <div class="detail-kicker">${it.kind === 'album' ? 'Album' : 'Playlist'} · Downloaded</div><h1>${esc(it.name)}</h1>
      <div class="detail-artist">${esc(it.artist || '')}</div><div class="detail-meta">${plural(songs.length, 'song')}</div>
      <div class="detail-actions"><button class="btn btn-primary" data-act="dl-play" data-key="${esc(key)}">${icon('play')}Play</button></div></div></header>
    ${trackRows(songs, { art: it.kind !== 'album', numbers: it.kind === 'album' ? 'track' : 'index' })}`;
  markPlaying();
  return true;
}

/* ================= Hooks into the app ================= */

// API: notice when the server can't be reached.
(() => {
  const call = API.call.bind(API);
  API.call = async (...args) => {
    try { const r = await call(...args); Offline.setOffline(!!r?.fromMemory || navigator.onLine === false); return r; }
    catch (e) { if (e.code === 0) Offline.setOffline(true); throw e; }
  };
})();
window.addEventListener('online', () => API.call('ping').catch(() => {}));
window.addEventListener('offline', () => Offline.setOffline(true));
document.addEventListener('visibilitychange', () => { if (!document.hidden && Offline.offline) API.call('ping').catch(() => {}); });

// Render: offline fallback, auto "load more", page decorations.
(() => {
  const render = UI.render.bind(UI);
  UI.render = async function () {
    const r = this.parse();
    if (Offline.offline && !['downloads', 'settings'].includes(r.name)) {
      this.route = r;
      const main = $('#main');
      const key = r.name === 'album' ? `album:${r.id}` : r.name === 'playlist' ? `playlist:${r.id}` : null;
      if (key && offlineItemView(main, key)) return;
      if (Offline.count()) { location.hash = '#/downloads'; return; }
    }
    const wasOffline = Offline.offline;
    await render();
    // The page failed because the server couldn't be reached (the device itself may look online):
    // now that we know, show the downloaded copy instead of the error.
    if (!wasOffline && Offline.offline && $('#main > .empty [data-act="reload"]')) return UI.render();
    const more = $('#more');
    if (more && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !more.hidden && !more.disabled) more.click(); }, { root: $('#main'), rootMargin: '800px' });
      io.observe(more);
      const prev = more.onclick;
      more.onclick = async () => { more.disabled = true; try { await prev(); } finally { more.disabled = false; } };
    }
    decorate(this.route);
  };
})();

function decorate(route) {
  const main = $('#main');
  if (route.name === 'album' && route.id) {
    const acts = $('.detail-actions', main);
    if (acts && !$('[data-dl]', acts)) acts.insertAdjacentHTML('beforeend', Offline.button('album', route.id));
    const songs = Lists.get($('.tracks .track', main)?.dataset.list) || [];
    const q = albumQuality(songs);
    const meta = $('.detail-meta', main);
    if (q && meta && !$('.qbadge', meta)) meta.insertAdjacentHTML('beforeend', ` ${badge(q, ` title="${esc(q.detail)}"`)}`);
  }
  if (route.name === 'playlist' && route.id) decoratePlaylist(main, route.id);
  if (route.name === 'playlists') {
    const head = $('.page-title', main);
    if (head && !$('[data-act="pl-new"]', main)) {
      head.outerHTML = `<div class="page-head"><h1 class="page-title">Playlists</h1><button class="btn btn-primary" data-act="pl-new">${icon('plus')}New Playlist</button></div>`;
    }
  }
}

async function decoratePlaylist(main, id) {
  const acts = $('.detail-actions', main);
  if (!acts) return;
  acts.insertAdjacentHTML('beforeend', Offline.button('playlist', id));
  const r = await API.call('getPlaylist', { id }).catch(() => null);
  const p = r?.playlist;
  if (!p || UI.route.id !== id) return;
  const owned = p.owner === API.user && !p.readonly;
  Playlists.current = owned ? p : null;
  if (!owned) return;
  acts.insertAdjacentHTML('beforeend', `<button class="icon-btn" data-act="pl-menu" aria-label="Edit playlist">${icon('more')}</button>`);
  const tracks = $('.tracks', main);
  if (!tracks) return;
  tracks.classList.add('sortable');
  $$('.track', tracks).forEach((row) => row.insertAdjacentHTML('afterbegin', `<span class="grip" aria-label="Drag to reorder">${icon('grip')}</span>`));
  sortable(tracks, {
    item: '.track', handle: '.grip', scroller: $('#main'),
    onDrop: async (from, to) => {
      const list = Lists.get($('.track', tracks).dataset.list);
      const ids = list.map((s) => s.id);
      const [m] = ids.splice(from, 1); ids.splice(to, 0, m);
      try { await Playlists.setOrder(id, ids); toast('Order saved'); } catch (e) { toast(e.message); }
      UI.render();
    },
  });
}

// Song menu: add to playlist, remove from this playlist.
const _songMenu = songMenu;
// eslint-disable-next-line no-func-assign
songMenu = function (anchor, s) {
  _songMenu(anchor, s);
  const extra = [{ key: 'addpl', label: 'Add to Playlist…', icon: 'playlist', run: () => Playlists.addTo(s) }];
  const p = Playlists.current;
  if (p && UI.route.name === 'playlist' && UI.route.id === p.id && anchor.closest('.tracks')) {
    const i = +anchor.dataset.i;
    extra.push({ key: 'rmpl', label: 'Remove from Playlist', icon: 'trash', run: async () => { await Playlists.removeIndex(p.id, i); toast('Removed from playlist'); UI.render(); } });
  }
  Menu.items.splice(3, 0, ...extra);
  Menu.open(anchor, Menu.items);
};

// Album menu: add album to playlist / download.
(() => {
  const orig = actions['menu-album'];
  actions['menu-album'] = async (el) => {
    orig(el);
    Menu.items.push('-', { key: 'addpl', label: 'Add to Playlist…', icon: 'playlist', run: async () => Playlists.addTo((await albumSongs(el.dataset.id)).songs) });
    Menu.open(el, Menu.items);
  };
})();

// Up Next: drag to reorder, save as playlist, clear.
(() => {
  const orig = UI.renderQueue.bind(UI);
  UI.renderQueue = function () {
    if (UI.dragging) return;
    orig();
    const box = $('#np-queue');
    if (!box || !Player.queue.length) return;
    const h = $('h3', box);
    if (h) h.outerHTML = `<div class="q-head"><h3>Up Next</h3><div>
        <button class="q-btn" data-act="q-save">${icon('plus')}Save as Playlist</button>
        ${Player.index < Player.queue.length - 1 ? `<button class="q-btn" data-act="q-clear">Clear</button>` : ''}</div></div>`;
    $$('.q-item', box).forEach((row) => {
      const i = +row.dataset.i;
      if (i > Player.index) row.insertAdjacentHTML('afterbegin', `<span class="grip q-grip" aria-label="Drag to reorder">${icon('grip')}</span>`);
      else row.insertAdjacentHTML('afterbegin', '<span class="grip q-grip off"></span>');
    });
    if (!box._sortable) {
      box._sortable = true;
      sortable(box, {
        item: '.q-item', handle: '.q-grip:not(.off)', scroller: box,
        canDrop: (t) => { const first = +$('.q-item', box).dataset.i; return first + t > Player.index; },
        onDrop: (from, to) => { const first = +$('.q-item', box).dataset.i; Player.move(first + from, first + to); },
      });
    }
  };
})();

// Now Playing: quality badge.
(() => {
  const sync = UI.syncPlayer.bind(UI);
  UI.syncPlayer = function () { sync(); Quality.sync(Player.current()); };
})();

// Settings: playback options.
(() => {
  const orig = View.settings;
  View.settings = async (main, ...rest) => {
    await orig(main, ...rest);
    const box = $('.settings', main);
    if (!box) return;
    const cf = Prefs.get('crossfade');
    const locked = Player.volLocked;
    box.insertAdjacentHTML('afterbegin', `
      <h2 class="set-group">Playback</h2>
      <div class="set-row"><div><h3>Crossfade</h3><p>${locked ? 'Not available in this browser: iPhone and iPad don\'t let web apps change volume. Songs still play gaplessly.' : 'Blend the end of one song into the next. Songs always play without gaps.'}</p></div>
        <div class="set-actions set-range"><input type="range" min="0" max="12" step="1" value="${cf}" data-pref="crossfade" ${locked ? 'disabled' : ''} aria-label="Crossfade seconds"><output>${cf ? cf + ' s' : 'Off'}</output></div></div>
      <div class="set-row"><div><h3>Keep albums gapless</h3><p>Don't crossfade between songs from the same album, so live albums and mixes flow as intended.</p></div>
        <label class="switch"><input type="checkbox" data-pref="smartFade" ${Prefs.get('smartFade') ? 'checked' : ''} ${locked ? 'disabled' : ''}><span></span></label></div>
      <div class="set-row"><div><h3>Volume levelling</h3><p>${locked ? 'Not available in this browser (iPhone and iPad).' : 'Evens out loud and quiet songs using ReplayGain tags. Automatic uses album levels when you play an album and song levels otherwise.'}</p></div>
        <div class="set-actions"><select class="select" data-pref="rg" ${locked ? 'disabled' : ''}>${[['auto', 'Automatic'], ['track', 'Song'], ['album', 'Album'], ['off', 'Off']].map(([v, l]) => `<option value="${v}"${Prefs.get('rg') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="set-row"><div><h3>Streaming quality</h3><p>Original plays your files as they are (lossless and hi-res stay intact). The others are converted by Navidrome to save data on mobile: Opus sounds as good as MP3 at about half the size and keeps albums gapless${CAN_OPUS ? '' : ' (this device can\'t play Opus, so it gets MP3 instead)'}.</p></div>
        <div class="set-actions"><select class="select" data-pref="quality">${[['original', 'Original'], ['opus128', 'Opus 128'], ['opus96', 'Opus 96'], ['high', 'MP3 320'], ['normal', 'MP3 192'], ['low', 'MP3 128']].map(([v, l]) => `<option value="${v}"${Prefs.get('quality') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="set-row"><div><h3>Download quality</h3><p>Original keeps lossless files (large: an album can be 1–2 GB in hi-res). Opus 128 is about half the size of MP3 320 at the same sound quality.</p></div>
        <div class="set-actions"><select class="select" data-pref="dlQuality">${[['opus128', 'Opus 128'], ['high', 'MP3 320'], ['original', 'Original']].map(([v, l]) => `<option value="${v}"${Prefs.get('dlQuality') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <div class="set-row"><div><h3>Save the next songs ahead</h3><p>${Offline.supported ? 'While a song plays, the next 3 are saved on this device one at a time, so the music keeps going if the connection drops. They are saved at your download quality and only played when the connection is gone; the last 10 are kept.' : 'Needs the secure (HTTPS) address, like downloads.'}</p></div>
        <label class="switch"><input type="checkbox" data-pref="ahead" ${Ahead.on() ? 'checked' : ''} ${Offline.supported ? '' : 'disabled'}><span></span></label></div>
      <div class="set-row"><div><h3>Playback log</h3><p>Why each song changed, newest first. If a song ever skips by itself, the reason shows up here.</p></div>
        <div class="set-actions"><button class="btn" data-playlog>Show</button><button class="btn" data-diag>Copy diagnostics</button></div></div>
      <div class="playlog" hidden></div>
      <h2 class="set-group">Account</h2>`);
    $('[data-playlog]', box).addEventListener('click', (e) => {
      const out = $('.playlog', box);
      out.hidden = !out.hidden;
      e.currentTarget.textContent = out.hidden ? 'Show' : 'Hide';
      const log = store.get('playlog') || [];
      out.innerHTML = log.length ? log.map((l) => `<div class="pl-row"><b>${esc(l.why)}</b><span>${esc(l.title)} · ${esc(l.artist || '')}</span><i>${new Date(l.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${esc(l.fmt || '')} · at ${fmtTime(l.pos)} of ${fmtTime(l.dur)}${l.tag && Math.abs(l.tag - l.dur) > 2 ? ' (tag says ' + fmtTime(l.tag) + ')' : ''}</i></div>`).join('') : '<p class="muted">Nothing recorded yet.</p>';
    });
    $('[data-diag]', box).addEventListener('click', async () => {
      const text = diagnostics();
      try { await navigator.clipboard.writeText(text); toast('Diagnostics copied. Paste them in your message.'); }
      catch { const out = $('.playlog', box); out.hidden = false; out.innerHTML = `<textarea class="diag-text" readonly>${esc(text)}</textarea>`; $('.diag-text', out).select(); toast('Select all and copy the text below'); }
    });
    const rng = $('[data-pref="crossfade"]', box);
    const paint = () => rng.style.setProperty('--p', (rng.value / 12) * 100 + '%');
    paint(); rng.addEventListener('input', paint);
    box.addEventListener('input', (e) => {
      const el = e.target.closest('[data-pref]');
      if (!el) return;
      const k = el.dataset.pref;
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
      Prefs.set(k, v);
      if (k === 'crossfade') el.nextElementSibling.textContent = v ? `${v} s` : 'Off';
      if (k === 'rg') Player.applyVolume();
      if (k === 'quality') Player.setQuality(v);
      if (k === 'ahead') { if (v) Ahead.run(); else Ahead.clear(); }
    });
  };
})();

/* ================= Big libraries: artists A–Z ================= */

View.artists = async (main) => {
  main.innerHTML = `<h1 class="page-title">Artists</h1><div id="artist-grid">${skeletonShelf()}</div>`;
  const r = await API.call('getArtists', {}, { cache: 5 * MIN });
  if (UI.route.name !== 'artists') return;
  const groups = (r.artists?.index || []).filter((g) => g.artist?.length);
  if (!groups.length) { $('#artist-grid').outerHTML = '<div class="empty"><h3>No artists yet</h3></div>'; return; }
  const box = $('#artist-grid');
  box.innerHTML = `<nav class="az" aria-label="Jump to letter">${groups.map((g) => `<a href="#" data-az="${esc(g.name)}">${esc(g.name)}</a>`).join('')}</nav><div class="az-groups"></div>`;
  const out = $('.az-groups', box);
  // Render in slices so huge libraries stay responsive.
  let gi = 0;
  const step = () => {
    if (UI.route.name !== 'artists') return;
    const t0 = performance.now();
    while (gi < groups.length && performance.now() - t0 < 12) {
      const g = groups[gi++];
      out.insertAdjacentHTML('beforeend', `<section class="az-group" id="az-${esc(g.name)}"><h2 class="az-head">${esc(g.name)}</h2>${grid(g.artist, artistCard)}</section>`);
    }
    if (gi < groups.length) requestAnimationFrame(step);
  };
  step();
  box.addEventListener('click', (e) => {
    const a = e.target.closest('[data-az]');
    if (!a) return;
    e.preventDefault();
    const go = () => { const el = document.getElementById('az-' + a.dataset.az); if (el) $('#main').scrollTo({ top: el.offsetTop - 10, behavior: 'smooth' }); else setTimeout(go, 50); };
    go();
  });
};

/* ================= Actions ================= */

Object.assign(actions, {
  'quality-info': (el) => Quality.pick(el),
  'pl-new': async () => {
    let created;
    const name = await Sheet.open({ title: 'New Playlist', input: { label: 'Name', placeholder: 'My playlist' }, ok: 'Create', onOk: async (v) => { created = await Playlists.create(v); } });
    if (name) { toast(`Created “${name}”`); if (created?.id) location.hash = '#/playlist/' + created.id; else UI.render(); }
  },
  'pl-menu': (el) => {
    const p = Playlists.current;
    if (!p) return;
    Menu.open(el, [
      { key: 'rename', label: 'Rename', icon: 'edit', run: () => Playlists.rename(p) },
      { key: 'delete', label: 'Delete Playlist', icon: 'trash', run: () => Playlists.remove(p) },
    ]);
  },
  'q-save': async () => {
    const songs = Player.queue.slice();
    const name = await Sheet.open({ title: 'Save Queue as Playlist', input: { label: 'Name', value: Radio.label() || `Queue ${new Date().toLocaleDateString()}` }, ok: 'Save',
      onOk: (v) => Playlists.create(v, songs.map((s) => s.id)) });
    if (name) toast(`Saved “${name}”`);
  },
  'q-clear': () => { Player.clearUpcoming(); toast('Up Next cleared'); },
  'dl-toggle': async (el) => {
    const [kind, id] = el.dataset.dl.split(':');
    if (Offline.has(el.dataset.dl) && !Offline.jobs.has(el.dataset.dl)) {
      const ok = await Sheet.open({ title: 'Remove download?', body: '<p>It stays in your library; it just won\'t play offline on this device.</p>', ok: 'Remove', danger: true });
      if (ok) Offline.removeItem(el.dataset.dl);
    } else return Offline.download(kind, id);
  },
  'dl-remove': async (el) => { await Offline.removeItem(el.dataset.key); UI.render(); },
  'dl-play': (el) => {
    const it = Offline.db().items[el.dataset.key];
    if (!it) return;
    const songs = it.songIds.map((id) => Offline.db().songs[id]).filter(Boolean);
    Player.playList(songs, 0, { shuffle: false });
  },
  'dl-shuffle': () => Player.playList(Offline.songs(), 0, { shuffle: true }),
});

/* Navigation links for Downloads */
(() => {
  const side = $('.side-nav');
  if (side && !$('[data-nav="downloads"]', side)) side.insertAdjacentHTML('beforeend', `<a href="#/downloads" data-nav="downloads"><span class="ico">${icon('download')}</span>Downloads</a>`);
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const links = $('.lib-links', main);
    if (links && !$('[href="#/downloads"]', links)) links.insertAdjacentHTML('beforeend', `<a href="#/downloads"><span class="ico">${icon('download')}</span>Downloads</a>`);
    return p;
  };
})();

Offline.register();
if (navigator.onLine === false) Offline.setOffline(true);
window.Offline = Offline;
window.Playlists = Playlists;

// Everything worth knowing about playback problems on this device, as plain text to paste (no passwords or tokens).
function diagnostics() {
  const a = Player.audio, sizes = {};
  try { for (const k of Object.keys(localStorage)) sizes[k] = (localStorage.getItem(k) || '').length; } catch { /* ignore */ }
  const big = Object.entries(sizes).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k.replace('mare.', '')} ${Math.round(n / 1024)} KB`).join(', ');
  const lines = [
    `Maré ${window.MARE_VERSION} · ${new Date().toISOString()}`,
    `Device: ${navigator.userAgent}`,
    `Home Screen app: ${navigator.standalone === true || matchMedia('(display-mode: standalone)').matches} · iPhone/iPad mode: ${Player.volLocked} · Opus: ${CAN_OPUS} · sound: ${navigator.audioSession?.state || 'n/a'}`,
    `Streaming: ${Prefs.get('quality')} · downloads: ${Prefs.get('dlQuality')} · save ahead: ${Ahead.on()} · offline now: ${!!Offline.offline}`,
    `Now: ${Player.current() ? `${Player.current().title} (${Player.current().suffix || '?'})` : 'nothing'} · ${a.paused ? 'paused' : 'playing'} at ${Math.round(Player.pos())} s · ${Player.diag()}`,
    `Storage: ${big}`,
    '', 'Playback log (newest first):',
    ...(store.get('playlog') || []).map((l) => `${new Date(l.t).toLocaleString()} | ${l.why} | ${l.title} · ${l.artist || ''} | ${l.fmt || ''} | at ${l.pos}/${l.dur} s (tag ${l.tag})`),
  ];
  return lines.join('\n');
}

/* ================= Next songs saved ahead =================
   While a song plays, the next 3 of the queue are saved one at a time (after the playing song has loaded), so a dropped
   connection doesn't stop the music. The service worker plays them from the "mare-ahead" cache; about 10 are kept. */
const Ahead = {
  CACHE: 'mare-ahead', NEXT: 3, KEEP: 10,
  busy: false, since: 0,
  on() { return Prefs.get('ahead') !== false && Offline.supported; },
  key(id) { return `/ahead/${id}`; },
  // Small copies (download quality, Opus 128 by default): they're only played when the connection drops.
  spec() { return qualitySpec(Prefs.get('dlQuality')); },
  list() { return store.get('ahead') || []; },
  has(id) { return this.list().includes(this.key(id)); },
  // The playing song has loaded far enough that saving the next ones won't compete with it.
  ready() {
    const a = Player.audio, d = Player.dur(), b = a.buffered;
    if (Offline.offline || !Player.current()) return false;
    if (Date.now() - this.since > 30000) return true;
    return !!(b.length && d && b.end(b.length - 1) + (a._offset || 0) >= d - 2);
  },
  async run() {
    if (this.busy || !this.on() || !this.ready()) return;
    const next = Player.queue.slice(Player.index + 1, Player.index + 1 + this.NEXT);
    const d = Offline.db();
    this.busy = true;
    try {
      const cache = await caches.open(this.CACHE);
      for (const s of next) {
        if (d.songs[s.id] || await cache.match(this.key(s.id))) continue;
        if (!this.on() || Offline.offline) break;
        const q = this.spec();
        const r = await fetch(API.stream(s.id, q ? { format: q.format, maxBitRate: q.kbps, estimateContentLength: true } : null));
        if (!r.ok) continue;
        const blob = await r.blob();
        await cache.put(this.key(s.id), new Response(blob, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'audio/mpeg', 'Content-Length': blob.size } }));
        const l = this.list().filter((k) => k !== this.key(s.id)); l.push(this.key(s.id));
        // Forget the oldest, but never one of the songs coming up.
        const keepNow = new Set(next.map((x) => this.key(x.id)));
        while (l.length > this.KEEP) { const i = l.findIndex((k) => !keepNow.has(k)); if (i < 0) break; await cache.delete(l.splice(i, 1)[0]); }
        store.set('ahead', l);
      }
    } catch { /* connection trouble: try again later */ } finally { this.busy = false; }
  },
  async clear() { store.del('ahead'); try { await caches.delete(this.CACHE); } catch { /* ignore */ } },
};
{
  const playing = Player.onPlaying.bind(Player);
  Player.onPlaying = function () { Ahead.since = Date.now(); playing(); setTimeout(() => Ahead.run(), 3000); };
  setInterval(() => { if (!Player.audio.paused && Player.index < Player.queue.length - 1) Ahead.run(); }, 10000);
}
window.Ahead = Ahead;
