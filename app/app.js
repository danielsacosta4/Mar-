/* Maré — a Navidrome (Subsonic / OpenSubsonic) web client. */
'use strict';
window.MARE_VERSION = '1.5.15';

/* ================= Utilities ================= */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (sec) => {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const fmtLong = (sec) => {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${r ? `, ${r} min` : ''}`;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shuffleArr = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const store = {
  get(k, d = null) { try { const v = localStorage.getItem('mare.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mare.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem('mare.' + k); } catch { /* ignore */ } },
};

const md5 = (() => {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  return (str) => {
    const bytes = new TextEncoder().encode(str);
    const len = bytes.length, n = (((len + 8) >> 6) + 1) * 16, w = new Uint32Array(n);
    for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
    w[len >> 2] |= 0x80 << ((len % 4) * 8);
    w[n - 2] = (len * 8) >>> 0; w[n - 1] = Math.floor(len / 536870912) >>> 0;
    let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
    for (let o = 0; o < n; o += 16) {
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; }
        else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
        else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i) % 16; }
        F = (F + A + K[i] + w[o + g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    return [a0, b0, c0, d0].map((x) => { let s = ''; for (let j = 0; j < 4; j++) s += ((x >>> (j * 8)) & 255).toString(16).padStart(2, '0'); return s; }).join('');
  };
})();

/* ================= Icons ================= */

const STROKE = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  album: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
  artist: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M18.5 11v1a6.5 6.5 0 0 1-13 0v-1"/><path d="M12 18.5V21"/>',
  song: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  playlist: '<path d="M3 6h13M3 12h9M3 18h9"/><path d="M20 4v11"/><circle cx="17.5" cy="16.5" r="2.5"/>',
  library: '<path d="M4 4v16M8 6v14M12 6v14"/><path d="m16 6 4 14"/>',
  heart: '<path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.2 4.4 6.6C19.5 15.4 12 20 12 20Z"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  repeat1: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1.5v5"/>',
  queue: '<path d="M3 6h18M3 12h18M3 18h11"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  volumeLow: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  playNext: '<path d="M3 6h12M3 12h8M3 18h8"/><path d="m15 13 6 3.5-6 3.5z"/>',
  addQueue: '<path d="M3 6h14M3 12h10M3 18h7"/><path d="M18 14v7M14.5 17.5h7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/>',
  lyrics: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/><path d="M9 10h6M9 14h4"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
const FILL = {
  play: '<path d="M7 4.6v14.8a1 1 0 0 0 1.5.126l12.3-7.4a1 1 0 0 0 0-1.72L8.5 3.74A1 1 0 0 0 7 4.6z"/>',
  pause: '<rect x="6" y="4" width="4.2" height="16" rx="1.2"/><rect x="13.8" y="4" width="4.2" height="16" rx="1.2"/>',
  next: '<path d="M2.5 6.6v10.8a.8.8 0 0 0 1.25.66L11.5 13v4.4a.8.8 0 0 0 1.25.66l8.3-5.4a.8.8 0 0 0 0-1.33l-8.3-5.4a.8.8 0 0 0-1.25.67V11L3.75 5.94a.8.8 0 0 0-1.25.66z"/>',
  prev: '<path d="M21.5 6.6v10.8a.8.8 0 0 1-1.25.66L12.5 13v4.4a.8.8 0 0 1-1.25.66l-8.3-5.4a.8.8 0 0 1 0-1.33l8.3-5.4a.8.8 0 0 1 1.25.67V11l7.75-5.06a.8.8 0 0 1 1.25.66z"/>',
  more: '<circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/>',
  heartFill: '<path d="M12 20s-7.5-4.6-9.2-9.4C1.6 7.2 3.8 4 7.2 4c2 0 3.6 1.1 4.8 2.8C13.2 5.1 14.8 4 16.8 4c3.4 0 5.6 3.2 4.4 6.6C19.5 15.4 12 20 12 20Z"/>',
};
const icon = (name) => FILL[name]
  ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${FILL[name]}</svg>`
  : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${STROKE[name] || ''}</svg>`;
const heartIcon = (on) => icon(on ? 'heartFill' : 'heart');

function paintIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}

/* ================= API ================= */

const API = {
  base: '', user: '', token: '', salt: '',
  CLIENT: 'Mare',

  load() {
    const s = store.get('session');
    if (!s) return false;
    Object.assign(this, s);
    return true;
  },
  save() { store.set('session', { base: this.base, user: this.user, token: this.token, salt: this.salt }); },
  clear() { store.del('session'); this.user = this.token = this.salt = ''; try { caches.delete('mare-pages'); } catch { /* ignore */ } },

  params(extra = {}) {
    const p = new URLSearchParams({ u: this.user, t: this.token, s: this.salt, v: '1.16.1', c: this.CLIENT, f: 'json' });
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.append(k, v);
    }
    return p;
  },
  url(method, extra) { return `${this.base}/rest/${method}?${this.params(extra)}`; },

  cache: new Map(),
  async call(method, extra = {}, { cache = 0 } = {}) {
    const url = this.url(method, extra);
    const key = method + JSON.stringify(extra);
    if (cache) {
      const hit = this.cache.get(key);
      if (hit && Date.now() - hit.t < cache) return hit.v;
    }
    let res;
    try { res = await fetch(url, { headers: { Accept: 'application/json' } }); }
    catch { throw new ApiError('Can\'t reach the server. Check your connection.', 0); }
    if (!res.ok) throw new ApiError(`Server returned ${res.status}.`, res.status);
    const json = await res.json();
    const body = json['subsonic-response'];
    if (!body || body.status !== 'ok') {
      const err = body?.error || {};
      throw new ApiError(err.message || 'Request failed.', err.code);
    }
    if (res.headers.get('X-Mare-Offline')) Object.defineProperty(body, 'fromMemory', { value: true }); // service worker, server unreachable
    else if (cache) this.cache.set(key, { t: Date.now(), v: body });
    return body;
  },
  bust() { this.cache.clear(); },

  cover(id, size = 300) { return id ? this.url('getCoverArt', { id, size }) : ''; },
  stream(id, extra) { return this.url('stream', { id, ...(extra || {}) }); },

  async login(base, user, pass) {
    this.base = (base || '').trim().replace(/\/+$/, '');
    this.user = user.trim();
    this.salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.token = md5(pass + this.salt);
    await this.call('ping');
    this.save();
  },
};
class ApiError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

const MIN = 60 * 1000;
const albums = async (type, size = 30, offset = 0, extra = {}) =>
  (await API.call('getAlbumList2', { type, size, offset, ...extra }, { cache: type === 'random' ? 0 : 2 * MIN })).albumList2?.album || [];

/* ================= Song registry & lists ================= */

const Songs = new Map();          // id -> song (shared, so star state stays in sync)
const Lists = new Map();          // listId -> song[] (what a click on a row plays)
let listSeq = 0;
function register(songs) {
  return (songs || []).map((s) => {
    const prev = Songs.get(s.id);
    const merged = prev ? Object.assign(prev, s) : s;
    Songs.set(s.id, merged);
    return merged;
  });
}
function newList(songs) {
  const id = 'l' + (++listSeq);
  Lists.set(id, register(songs));
  if (Lists.size > 40) Lists.delete(Lists.keys().next().value);
  return id;
}

/* ================= Artwork tint ================= */

const tintCache = new Map();
// The cover's main colour: the strongest hue family wins (so a yellow cover with a blue disc stays yellow,
// instead of averaging to mud). Mostly grey/black/white covers give their average.
function extractTint(src) {
  if (!src) return Promise.resolve(null);
  if (tintCache.has(src)) return Promise.resolve(tintCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const N = 32;
        const c = document.createElement('canvas'); c.width = c.height = N;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, N, N);
        const d = ctx.getImageData(0, 0, N, N).data;
        const buckets = Array.from({ length: 12 }, () => [0, 0, 0, 0]);
        const all = [0, 0, 0, 0];
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          all[0] += R; all[1] += G; all[2] += B; all[3]++;
          const sat = max ? (max - min) / max : 0, val = max / 255;
          if (sat < 0.3 || val < 0.2) continue;
          let h;
          if (max === R) h = ((G - B) / (max - min) + 6) % 6;
          else if (max === G) h = (B - R) / (max - min) + 2;
          else h = (R - G) / (max - min) + 4;
          const k = Math.floor(h * 2) % 12, w = sat * val;
          const bk = buckets[k];
          bk[0] += R * w; bk[1] += G * w; bk[2] += B * w; bk[3] += w;
        }
        const best = buckets.reduce((a, b) => (b[3] > a[3] ? b : a));
        const rgb = best[3] > all[3] * 0.08
          ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]]
          : [all[0] / all[3], all[1] / all[3], all[2] / all[3]];
        const out = rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))));
        tintCache.set(src, out);
        resolve(out);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
// Black or off-white lettering, whichever has more contrast on the colour.
function inkOn(rgb) {
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return (L + 0.05) / 0.0566 >= 1.05 / (L + 0.05) ? 'dark' : 'light';
}
const INK = { dark: '17, 17, 17', light: '250, 248, 243' };
function setColour(el, rgb, name = 'tint') {
  if (!el || !rgb) return;
  const ink = inkOn(rgb);
  el.style.setProperty(`--${name}`, rgb.join(', '));
  el.style.setProperty(`--${name === 'tint' ? 'on-tint' : name + '-on'}`, INK[ink]);
  if (name === 'tint') el.dataset.ink = ink;
}
async function applyTint(el, src) {
  setColour(el, await extractTint(src));
}

/* ================= UI helpers ================= */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

const artImg = (id, size, alt = '') => id
  ? `<img loading="lazy" src="${esc(API.cover(id, size))}" alt="${esc(alt)}">`
  : `<div class="art-fallback">${icon('song')}</div>`;

function albumCard(a) {
  return `<a class="card" href="#/album/${esc(a.id)}">
    <div class="art">${artImg(a.coverArt, 300)}
      <button class="art-play" data-act="play-album" data-id="${esc(a.id)}" aria-label="Play ${esc(a.name)}">${icon('play')}</button>
    </div>
    <div class="card-title">${esc(a.name)}</div>
    <div class="card-sub">${esc(a.artist || '')}</div>
  </a>`;
}
function artistCard(a) {
  return `<a class="card card-round" href="#/artist/${esc(a.id)}">
    <div class="art">${a.coverArt ? artImg(a.coverArt, 300) : `<div class="art-fallback">${icon('artist')}</div>`}
      <button class="art-play" data-act="play-artist" data-id="${esc(a.id)}" aria-label="Play ${esc(a.name)}">${icon('play')}</button>
    </div>
    <div class="card-title">${esc(a.name)}</div>
  </a>`;
}
function playlistCard(p) {
  return `<a class="card" href="#/playlist/${esc(p.id)}">
    <div class="art">${artImg(p.coverArt, 300)}
      <button class="art-play" data-act="play-playlist" data-id="${esc(p.id)}" aria-label="Play ${esc(p.name)}">${icon('play')}</button>
    </div>
    <div class="card-title">${esc(p.name)}</div>
    <div class="card-sub">${plural(p.songCount || 0, 'song')}</div>
  </a>`;
}

function section(title, body, link) {
  return `<section class="section">
    <div class="section-head"><h2>${esc(title)}</h2>${link ? `<a href="${esc(link)}">See all</a>` : ''}</div>
    ${body}
  </section>`;
}
const shelf = (items, card = albumCard) => items.length ? `<div class="shelf">${items.map(card).join('')}</div>` : '';
const grid = (items, card = albumCard) => `<div class="grid">${items.map(card).join('')}</div>`;

function trackRows(songs, { art = false, album = true, numbers = 'track', discs = false, sides = false } = {}) {
  const listId = newList(songs);
  const list = Lists.get(listId);
  const row = (s, i) => {
    const num = numbers === 'track' ? (s.track || i + 1) : i + 1;
    const lead = art
      ? `<img class="t-thumb" loading="lazy" src="${esc(API.cover(s.coverArt, 80))}" alt="">`
      : `<span class="t-num" data-num="${num}">${num}</span>`;
    return `<div class="track" data-act="play-row" data-list="${listId}" data-i="${i}" data-song="${esc(s.id)}">
      ${lead}
      <div class="t-main">
        <div class="t-title">${esc(s.title)}<span class="t-rating">${s.userRating ? '★'.repeat(s.userRating) : ''}</span></div>
        <div class="t-sub">${s.artistId ? `<a href="#/artist/${esc(s.artistId)}" data-stop>${esc(s.artist)}</a>` : esc(s.artist || '')}</div>
      </div>
      ${art && album ? `<a class="t-album" href="#/album/${esc(s.albumId)}" data-stop>${esc(s.album || '')}</a>` : ''}
      <button class="t-heart${s.starred ? ' on' : ''}" data-act="star" data-id="${esc(s.id)}" aria-label="Favorite">${heartIcon(!!s.starred)}</button>
      <span class="t-dur">${fmtTime(s.duration)}</span>
      <button class="t-more" data-act="menu-song" data-id="${esc(s.id)}" data-list="${listId}" data-i="${i}" aria-label="More">${icon('more')}</button>
    </div>`;
  };
  const multiDisc = (discs || sides) && new Set(list.map((s) => s.discNumber || 1)).size > 1;
  if (sides) {
    const groups = sideGroups(list, multiDisc);
    return `<div class="tracks sides${groups.length === 2 ? ' two' : ''}">${groups.map((g) => `<div class="side">${groups.length > 1
      ? `<div class="side-head"><span class="cond">${esc(g.name)}</span><span class="label">${Math.round(g.items.reduce((t, x) => t + (x.s.duration || 0), 0) / 60)} min</span></div>` : ''}${g.items.map((x) => row(x.s, x.i)).join('')}</div>`).join('')}</div>`;
  }
  let html = '';
  let lastDisc = null;
  list.forEach((s, i) => {
    if (multiDisc && (s.discNumber || 1) !== lastDisc) {
      lastDisc = s.discNumber || 1;
      html += `<div class="disc-label">Disc ${lastDisc}</div>`;
    }
    html += row(s, i);
  });
  return `<div class="tracks${art ? ' with-art' : ''}${art && !album ? ' no-album' : ''}">${html}</div>`;
}

// An album as a record: one side per disc, or a single disc cut into Side A and Side B at the halfway point.
function sideGroups(list, multiDisc) {
  const items = list.map((s, i) => ({ s, i }));
  if (multiDisc) {
    const by = new Map();
    items.forEach((x) => { const d = x.s.discNumber || 1; if (!by.has(d)) by.set(d, []); by.get(d).push(x); });
    return [...by].map(([d, g]) => ({ name: `Disc ${d}`, items: g }));
  }
  if (items.length < 4) return [{ name: '', items }];
  const total = list.reduce((t, s) => t + (s.duration || 0), 0);
  let acc = 0, cut = 1, best = Infinity;
  for (let k = 1; k < items.length; k++) {
    acc += list[k - 1].duration || 0;
    const diff = Math.abs(total / 2 - acc);
    if (diff < best) { best = diff; cut = k; }
  }
  return [{ name: 'Side A', items: items.slice(0, cut) }, { name: 'Side B', items: items.slice(cut) }];
}

function markPlaying() {
  const cur = Player.current();
  const paused = Player.audio.paused;
  $$('.chart-row[data-song]').forEach((row) => row.classList.toggle('is-playing', !!cur && row.dataset.song === cur.id));
  $$('.track').forEach((row) => {
    const on = !!cur && row.dataset.song === cur.id;
    row.classList.toggle('is-playing', on);
    row.classList.toggle('paused', on && paused);
    const num = $('.t-num', row);
    if (num) num.innerHTML = on ? '<span class="eq"><i></i><i></i><i></i></span>' : num.dataset.num;
  });
}

const skeletonShelf = () => `<div class="shelf">${'<div><div class="art skel"></div></div>'.repeat(6)}</div>`;

/* ================= Player ================= */

/* Playback preferences (per browser). */
const Prefs = {
  defaults: { crossfade: 0, smartFade: true, rg: 'auto', quality: 'original', dlQuality: 'high' },
  get(k) { const p = store.get('prefs') || {}; return k in p ? p[k] : this.defaults[k]; },
  set(k, v) { const p = store.get('prefs') || {}; p[k] = v; store.set('prefs', p); },
};
// Streaming / download qualities. Opus sounds about as good as MP3 at twice the bitrate and keeps albums gapless
// (no encoder padding); devices that can't play it (iPhones before iOS 17) quietly get a comparable MP3 instead.
const CAN_OPUS = (() => { try { return !!new Audio().canPlayType('audio/ogg; codecs="opus"'); } catch { return false; } })();
const QUALITIES = {
  original: null,
  opus128: { format: 'opus', kbps: 128, mp3: 320 },
  opus96: { format: 'opus', kbps: 96, mp3: 192 },
  high: { format: 'mp3', kbps: 320 },
  normal: { format: 'mp3', kbps: 192 },
  low: { format: 'mp3', kbps: 128 },
};
// What actually gets requested for a quality key: { format, kbps } or null for the original file.
function qualitySpec(key) {
  const q = QUALITIES[key];
  if (!q) return null;
  return q.format === 'opus' && !CAN_OPUS ? { format: 'mp3', kbps: q.mp3 } : q;
}
const specName = (q) => `${q.format === 'opus' ? 'Opus' : 'MP3'} ${q.kbps}`;

/* Two audio elements: one plays, the other preloads the next song for gapless and crossfade. */
const Player = {
  els: [new Audio(), new Audio()], cur: 0,
  get audio() { return this.els[this.cur]; },
  get spare() { return this.els[1 - this.cur]; },
  vol: 1, volLocked: false, preId: null, fade: null, gapTimer: null,
  queue: [], index: -1, order: null,   // order: original queue before shuffling
  shuffle: false, repeat: 'off',      // off | all | one
  scrobbled: false, nowPlayingSent: false, playedSec: 0, lastTick: 0,

  current() { return this.queue[this.index] || null; },

  // Converted streams can't be seeked by the browser (no byte ranges), so a converted song starts from a position
  // with timeOffset and the element remembers that offset (el._offset). pos()/dur() hide this from the rest.
  transcodes(song) {
    const q = qualitySpec(Prefs.get('quality'));
    if (!q || !song || window.Offline?.hasSong?.(song.id)) return false;   // downloads play the stored copy
    // Navidrome passes a file through untouched when it's already in that format at or below that bitrate.
    return !(String(song.suffix || '').toLowerCase() === q.format && song.bitRate && song.bitRate <= q.kbps);
  },
  src(song, offset = 0) {
    const q = qualitySpec(Prefs.get('quality'));
    return API.stream(song.id, q ? { format: q.format, maxBitRate: q.kbps, ...(offset >= 1 ? { timeOffset: Math.floor(offset) } : {}) } : null);
  },
  setSrc(el, song, offset = 0) {
    if (el === this.audio) this.ownPause = Date.now();   // a new source pauses the element: that's us, not the headphones
    el._song = song;
    el._offset = offset >= 1 && this.transcodes(song) ? Math.floor(offset) : 0;
    el.src = this.src(song, el._offset);
  },
  pos(el = this.audio) { return (el.currentTime || 0) + (el._offset || 0); },
  dur(el = this.audio) {
    const s = el._song || (el === this.audio ? this.current() : null), d = el.duration;
    if ((el._offset || (s && this.transcodes(s))) && s?.duration) return s.duration;
    return d && isFinite(d) ? d : s?.duration || 0;
  },
  seek(t, el = this.audio) {
    const s = el._song;
    if (!s) return;
    t = Math.max(0, Math.min(t, (this.dur(el) || t + 1) - 0.5));
    if (this.transcodes(s)) {
      const playing = !el.paused;
      this.setSrc(el, s, t);
      if (playing) el.play().catch(() => {});
      this.onTime(true);
    } else if (el._offset) {
      // Was converted, now isn't: load the original and jump there.
      const playing = !el.paused;
      this.setSrc(el, s);
      el.addEventListener('loadedmetadata', () => { el.currentTime = t; }, { once: true });
      if (playing) el.play().catch(() => {});
    } else el.currentTime = t;
  },
  // Change streaming quality; the song that's playing switches straight away, at the same point.
  setQuality(q) {
    Prefs.set('quality', q);
    if (this.preId) { const sp = this.spare; sp.pause(); sp.removeAttribute('src'); sp._song = null; this.preId = null; }
    const a = this.audio, s = this.current();
    if (s && a.getAttribute('src')) {
      const t = this.pos(), playing = !a.paused;
      this.stopFade();
      this.setSrc(a, s, t);
      if (!a._offset && t > 0.5) a.addEventListener('loadedmetadata', () => { a.currentTime = t; }, { once: true });
      if (playing) a.play().catch(() => {});
    }
    this.sync();
  },

  init() {
    // iOS doesn't let pages change an element's volume; crossfade and levelling need it.
    try { const t = new Audio(); t.volume = 0.5; this.volLocked = t.volume !== 0.5; } catch { this.volLocked = true; }
    // iOS 17+: say this is a music player, so the sound keeps working on the lock screen (like a music app).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    // Unlocking while "playing" with the sound cut off: reconnect it.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.volLocked && !this.audio.paused && this.sessionOff()) this.refresh('sound was off after unlocking, reconnecting');
    });
    this.els.forEach((el) => {
      el.preload = 'auto'; el._fade = 1;
      const mine = (fn) => (e) => { if (el === this.audio) fn(e); };
      el.addEventListener('play', mine(() => {
        this.sync();
        // iPhone: after AirPods are taken out and put back, iOS resumes the player but its sound stays disconnected
        // (time runs, nothing is heard). Reloading at the same point reconnects it, like pause + play by hand.
        if (this.sysPaused && this.volLocked) { this.sysPaused = false; this.refresh('resumed after headphones'); }
      }));
      el.addEventListener('pause', mine(() => {
        this.sync(); this.persist();
        if (this.volLocked && !el.ended && Date.now() - (this.ownPause || 0) > 800) { this.sysPaused = true; this.note('paused by headphones or system'); }
      }));
      el.addEventListener('playing', mine(() => this.onPlaying()));
      el.addEventListener('timeupdate', mine(() => this.onTime()));
      el.addEventListener('durationchange', mine(() => this.onTime(true)));
      el.addEventListener('ended', mine(() => this.onEnded()));
      el.addEventListener('error', (e) => {
        if (el !== this.audio) { this.preId = null; return; }
        if (!this.current() || !el.getAttribute('src')) return;
        const code = el.error?.code || '';
        // A dropped connection mid-song shows up as an error: pick the song up where it stopped instead of skipping.
        if (navigator.onLine !== false && this.resume(`error ${code}, resuming`)) return;
        toast(navigator.onLine === false ? 'You\'re offline and this song isn\'t downloaded.' : 'This track can\'t be played. Skipping.');
        this.note('error ' + code);
        setTimeout(() => this.next(true, 'skipped after error'), 800);
      });
    });
    const saved = store.get('player');
    if (saved) {
      this.queue = register(saved.queue || []);
      this.index = Math.min(saved.index ?? -1, this.queue.length - 1);
      this.shuffle = !!saved.shuffle; this.repeat = saved.repeat || 'off';
      this.order = saved.order ? register(saved.order) : null;
      this.vol = saved.volume ?? 1;
      if (this.current()) {
        const a = this.audio;
        const t = saved.time || 0;
        this.setSrc(a, this.current(), t);
        this.applyVolume();
        if (!a._offset) a.addEventListener('loadedmetadata', () => { if (t && t < a.duration - 2) a.currentTime = t; }, { once: true });
      }
    }
    window.addEventListener('pagehide', () => this.persist());
    setInterval(() => { if (!this.audio.paused) this.persist(); }, 15000);
    setInterval(() => this.tick(), 100);
    this.setupMediaSession();
    this.sync();
  },

  persist() {
    store.set('player', {
      queue: this.queue.slice(0, 1000), index: this.index, order: this.order ? this.order.slice(0, 1000) : null,
      shuffle: this.shuffle, repeat: this.repeat, volume: this.vol, time: this.pos(),
    });
  },

  /* ---------- volume & levelling ---------- */
  gainFor(el) {
    const s = el._song, mode = Prefs.get('rg');
    const rg = s?.replayGain;
    if (mode === 'off' || !rg) return 1;
    let album = mode === 'album';
    if (mode === 'auto') {
      // Album gain when the neighbours in the queue are from the same album (listening to an album), track gain otherwise.
      const i = this.queue.indexOf(s);
      const nb = [this.queue[i - 1], this.queue[i + 1]].filter(Boolean);
      album = nb.length > 0 && nb.every((n) => n.albumId && n.albumId === s.albumId);
    }
    const gain = album ? (rg.albumGain ?? rg.trackGain) : (rg.trackGain ?? rg.albumGain);
    const peak = album ? (rg.albumPeak ?? rg.trackPeak) : (rg.trackPeak ?? rg.albumPeak);
    if (gain == null) return 1;
    let lin = Math.pow(10, gain / 20);
    if (peak > 0) lin = Math.min(lin, 1 / peak);
    return Math.min(1, lin);
  },
  applyVolume() {
    if (this.volLocked) return;
    this.els.forEach((el) => { el.volume = Math.max(0, Math.min(1, this.vol * this.gainFor(el) * (el._fade ?? 1))); });
  },
  setVolume(v) { this.vol = Math.max(0, Math.min(1, v)); this.applyVolume(); },

  /* ---------- queue ---------- */
  // shuffle: true = shuffle, false = play in order (turns shuffle off), undefined = keep current mode
  playList(songs, start = 0, { shuffle, keepRadio } = {}) {
    if (!keepRadio) window.Radio?.clear();
    songs = register(songs).filter(Boolean);
    if (!songs.length) { toast('Nothing to play here yet.'); return; }
    if (shuffle) {
      this.shuffle = true;
      this.order = songs.slice();
      this.queue = shuffleArr(songs);
      this.index = 0;
    } else if (this.shuffle && shuffle !== false) {
      // Keep shuffle on: start with the chosen song, shuffle the rest.
      this.order = songs.slice();
      const first = songs[start];
      this.queue = [first, ...shuffleArr(songs.filter((_, i) => i !== start))];
      this.index = 0;
    } else {
      this.shuffle = false;
      this.order = null;
      this.queue = songs.slice();
      this.index = start;
    }
    this.load(true);
  },

  resetTrackState() { this.scrobbled = false; this.nowPlayingSent = false; this.playedSec = 0; this.lastTick = 0; },

  stopFade() {
    if (!this.fade) return;
    clearInterval(this.fade.timer);
    const old = this.fade.old;
    old.pause(); old.removeAttribute('src'); old._song = null;
    this.audio._fade = 1;
    this.fade = null;
    this.applyVolume();
  },

  load(autoplay) {
    const s = this.current();
    if (!s) return;
    this.stopFade();
    clearTimeout(this.gapTimer); this.gapTimer = null;
    this.resetTrackState();
    const a = this.audio;
    // Reuse the preloaded element if it already holds this song.
    if (!this.volLocked && this.preId === s.id && this.spare.getAttribute('src')) {
      a.pause(); a.removeAttribute('src'); a._song = null;
      this.cur = 1 - this.cur;
    } else {
      this.setSrc(a, s);
    }
    this.preId = null;
    this.audio._fade = 1;
    this.applyVolume();
    if (autoplay) this.audio.play().catch(() => {});
    this.sync(); this.persist();
    window.Radio?.maybeRefill();
  },

  peekNext() {
    if (this.repeat === 'one') return null;
    let i = this.index + 1;
    if (i >= this.queue.length) { if (this.repeat !== 'all') return null; i = 0; }
    const s = this.queue[i];
    return s ? { song: s, i } : null;
  },

  fadeFor(cur, nxt) {
    const cf = Prefs.get('crossfade');
    if (!cf || this.volLocked || !cur || !nxt) return 0;
    if (Prefs.get('smartFade') && cur.albumId && cur.albumId === nxt.albumId) return 0;   // keep albums gapless
    return Math.min(cf, this.dur() / 3);
  },

  // Keeps a short log of why the song changed (Settings > Playback log), to explain unexpected skips.
  note(why) {
    const s = this.current();
    if (!s) return;
    const log = store.get('playlog') || [];
    log.unshift({ t: Date.now(), title: s.title, artist: s.artist, fmt: s.suffix, pos: Math.round(this.pos()), dur: Math.round(this.dur()), tag: s.duration || 0, why });
    store.set('playlog', log.slice(0, 60));
  },

  // Runs every 100 ms: preloads the next song and starts it on time.
  tick() {
    const a = this.audio;
    // iPhone/iPad only let an audio player start on its own once it has been tapped, so the second (preloading)
    // player couldn't start the next song. There (no crossfade anyway) every song plays in the same player.
    if (this.volLocked) return;
    if (a.paused || this.fade || !this.current()) return;
    const d = this.dur();
    if (!d) return;
    const rem = d - this.pos();
    const nx = this.peekNext();
    if (!nx) return;
    if (this.preId !== nx.song.id && rem < 40) {
      const sp = this.spare;
      sp._fade = 0;
      this.setSrc(sp, nx.song);
      sp.load();
      this.preId = nx.song.id;
      this.applyVolume();
    }
    if (this.preId !== nx.song.id || this.spare.readyState < 3) return;
    const fade = this.fadeFor(this.current(), nx.song);
    if (fade > 0) { if (rem <= fade) this.advance(nx.i, fade); return; }
    if (rem < 0.6 && !this.gapTimer) {
      // Schedule the switch precisely instead of waiting for the next tick.
      const ms = Math.max(0, (rem - 0.04) * 1000 / (a.playbackRate || 1));
      this.gapTimer = setTimeout(() => { this.gapTimer = null; if (!this.audio.paused && this.preId === nx.song.id) this.advance(nx.i, 0); }, ms);
    }
  },

  advance(i, fade) {
    const old = this.audio;
    this.note(fade > 0 ? 'crossfade' : 'end of song');
    this.finishScrobble();
    this.cur = 1 - this.cur;
    this.index = i;
    this.preId = null;
    this.resetTrackState();
    const a = this.audio;
    a.currentTime = 0;
    if (fade > 0) {
      a._fade = 0; old._fade = 1;
      const t0 = performance.now();
      this.fade = { old, timer: setInterval(() => {
        const k = Math.min(1, (performance.now() - t0) / (fade * 1000));
        // Equal-power curve so the overall loudness stays even through the blend.
        a._fade = Math.sin(k * Math.PI / 2); old._fade = Math.cos(k * Math.PI / 2);
        this.applyVolume();
        if (k >= 1) this.stopFade();
      }, 40) };
    } else {
      a._fade = 1;
      old.pause(); old.removeAttribute('src'); old._song = null;
    }
    this.applyVolume();
    a.play().catch(() => {});
    this.sync(); this.persist();
    window.Radio?.maybeRefill();
  },

  toggle() {
    if (!this.current()) return;
    if (this.audio.paused) { this.sysPaused = false; this.audio.play().catch(() => {}); }
    else { this.ownPause = Date.now(); this.stopFade(); this.audio.pause(); }
  },

  // Reload the playing song at the same point and keep playing (reconnects iOS audio after a headphone resume).
  refresh(why, tries = 0) {
    const s = this.current(), a = this.audio;
    if (!s) return;
    const p = this.pos();
    this.ownPause = Date.now();
    this.note(`${why} (${document.hidden ? 'locked' : 'open'}${navigator.audioSession ? ', sound ' + navigator.audioSession.state : ''})`);
    this.setSrc(a, s, p);
    if (!a._offset && p > 0.5) a.addEventListener('loadedmetadata', () => { a.currentTime = p; }, { once: true });
    a.play().catch(() => {});
    // Check that it really plays: time must move and iOS must report the sound as on. If not, pause + play
    // (what fixes it by hand), and once more a reload.
    clearTimeout(this._check);
    this._check = setTimeout(() => {
      if (this.current() !== s || a.paused || tries > 1) return;
      const stuck = this.pos() < p + 1;
      if (!stuck && !this.sessionOff()) { if (tries) this.note('sound back'); return; }
      if (tries === 0) {
        this.note(`no sound after resume (${stuck ? 'not moving' : 'sound ' + navigator.audioSession.state}), pause + play`);
        this.ownPause = Date.now(); a.pause();
        setTimeout(() => { a.play().catch(() => {}); this._check = setTimeout(() => {
          if (this.current() === s && !a.paused && (this.pos() < p + 1.5 || this.sessionOff())) this.refresh('still no sound, reloading', 2);
          else this.note('sound back');
        }, 2500); }, 300);
      }
    }, 2500);
  },
  sessionOff() { const st = navigator.audioSession?.state; return !!st && st !== 'active'; },

  next(auto = false, why) {
    if (!this.queue.length) return;
    this.note(why || (auto ? 'ended' : 'next tapped'));
    if (this.index < this.queue.length - 1) { this.index++; this.load(true); }
    else if (this.repeat === 'all' || !auto) { this.index = 0; this.load(this.repeat === 'all' || !auto); if (!auto && this.repeat !== 'all') { this.ownPause = Date.now(); this.audio.pause(); } }
    else { this.ownPause = Date.now(); this.audio.pause(); this.seek(0); this.sync(); }
  },

  prev() {
    if (!this.queue.length) return;
    if (this.pos() > 3 || this.index === 0) { this.seek(0); return; }
    this.note('previous tapped');
    this.index--; this.load(true);
  },

  seekFraction(f) {
    const d = this.dur();
    if (d) { this.stopFade(); clearTimeout(this.gapTimer); this.gapTimer = null; this.seek(f * d); }
  },

  jump(i) { if (this.queue[i]) { this.note('queue tap'); this.index = i; this.load(true); } },

  playNext(songs) {
    songs = register(Array.isArray(songs) ? songs : [songs]);
    if (!this.current()) { this.playList(songs); return; }
    this.queue.splice(this.index + 1, 0, ...songs);
    if (this.order) this.order.push(...songs);
    this.sync(); this.persist();
  },

  addToQueue(songs) {
    songs = register(Array.isArray(songs) ? songs : [songs]);
    if (!this.current()) { this.playList(songs); return; }
    this.queue.push(...songs);
    if (this.order) this.order.push(...songs);
    this.sync(); this.persist();
  },

  removeAt(i) {
    if (i === this.index) return;
    const [s] = this.queue.splice(i, 1);
    if (i < this.index) this.index--;
    if (this.order && s) { const j = this.order.indexOf(s); if (j >= 0) this.order.splice(j, 1); }
    this.sync(); this.persist();
  },

  move(from, to) {
    if (from === to || !this.queue[from]) return;
    const [s] = this.queue.splice(from, 1);
    this.queue.splice(to, 0, s);
    if (from === this.index) this.index = to;
    else if (from < this.index && to >= this.index) this.index--;
    else if (from > this.index && to <= this.index) this.index++;
    this.sync(); this.persist();
  },

  clearUpcoming() {
    this.queue = this.queue.slice(0, this.index + 1);
    if (this.order) this.order = this.queue.slice();
    window.Radio?.clear();
    this.sync(); this.persist();
  },

  toggleShuffle() {
    const cur = this.current();
    if (!this.shuffle) {
      this.shuffle = true;
      this.order = this.queue.slice();
      const rest = this.queue.filter((_, i) => i !== this.index);
      this.queue = cur ? [cur, ...shuffleArr(rest)] : shuffleArr(rest);
      this.index = cur ? 0 : -1;
    } else {
      this.shuffle = false;
      if (this.order) {
        this.queue = this.order;
        this.index = cur ? Math.max(0, this.queue.indexOf(cur)) : -1;
      }
      this.order = null;
    }
    toast(this.shuffle ? 'Shuffle on' : 'Shuffle off');
    this.sync(); this.persist();
  },

  cycleRepeat() {
    this.repeat = { off: 'all', all: 'one', one: 'off' }[this.repeat];
    toast({ off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' }[this.repeat]);
    this.sync(); this.persist();
  },

  scrobble(id, submission) {
    const params = { id, submission, ...(submission ? { time: Date.now() } : {}) };
    API.call('scrobble', params).catch(() => {
      // Offline: keep finished plays and send them when the connection is back.
      if (!submission) return;
      const q = store.get('scrobbleQueue') || [];
      q.push(params); store.set('scrobbleQueue', q.slice(-500));
    });
  },
  async flushScrobbles() {
    const q = store.get('scrobbleQueue') || [];
    if (!q.length) return;
    const left = [];
    for (const p of q) { try { await API.call('scrobble', p); } catch { left.push(p); } }
    store.set('scrobbleQueue', left);
  },

  onPlaying() {
    const s = this.current();
    if (s && !this.nowPlayingSent) { this.nowPlayingSent = true; this.scrobble(s.id, false); }
  },

  finishScrobble() {
    const s = this.current();
    const d = this.dur();
    if (s && !this.scrobbled && d > 30 && this.playedSec >= Math.min(d / 2, 240) - 1) { this.scrobbled = true; this.scrobble(s.id, true); }
  },

  onTime(force) {
    const a = this.audio;
    const d = this.dur();
    const t = this.pos();
    // Count real listening time so seeking doesn't trigger a scrobble.
    if (!a.paused && this.lastTick && t > this.lastTick && t - this.lastTick < 2) this.playedSec += t - this.lastTick;
    this.lastTick = t;
    const s = this.current();
    if (s && !this.scrobbled && d > 30 && this.playedSec >= Math.min(d / 2, 240)) { this.scrobbled = true; this.scrobble(s.id, true); }
    window.Lyrics?.onTime(t);
    if (UI.scrubbing && !force) return;
    const p = d ? (t / d) * 100 : 0;
    $$('.scrubber').forEach((r) => { r.value = Math.round(p * 10); r.style.setProperty('--p', p + '%'); });
    $$('.p-cur').forEach((e) => { e.textContent = fmtTime(t); });
    $$('.p-dur').forEach((e) => { e.textContent = fmtTime(d); });
    $('.p-mini-progress span').style.width = p + '%';
    if ('mediaSession' in navigator && d && navigator.mediaSession.setPositionState) {
      try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(t, d), playbackRate: 1 }); } catch { /* ignore */ }
    }
  },

  // Reload the playing song at the point it stopped, when that was mid-song (a dropped or cut-short stream).
  // Up to 3 times per song, and only if it got further than last time; returns false when it gave up.
  resume(why) {
    const s = this.current(), p = this.pos(), d = s?.duration || 0, cut = this.cut?.id === s?.id ? this.cut : (this.cut = { id: s?.id, n: 0, p: -9 });
    if (!(s && d > 20 && p >= 1 && p < d - 3 && cut.n < 3 && p > cut.p + 1)) return false;
    cut.n++; cut.p = p;
    this.note(why);
    const a = this.audio;
    this.setSrc(a, s, p);
    if (!a._offset) a.addEventListener('loadedmetadata', () => { a.currentTime = p; }, { once: true });
    a.play().catch(() => {});
    return true;
  },

  onEnded() {
    // A stream cut short by a proxy or the network ends "normally" mid-song: pick the song up again where it stopped.
    if (this.repeat !== 'one' && this.resume('cut off early, resuming')) return;
    this.finishScrobble();
    if (this.repeat === 'one') { this.audio.currentTime = 0; this.load(true); return; }
    this.next(true);
  },

  sync() { UI.syncPlayer(); },

  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const h = {
      play: () => { if (this.sysPaused && this.volLocked) { this.sysPaused = false; this.refresh('resumed after headphones'); } else this.audio.play(); },
      pause: () => { this.ownPause = Date.now(); this.stopFade(); this.audio.pause(); },
      previoustrack: () => this.prev(), nexttrack: () => this.next(false, 'headset / media key'),
      seekto: (e) => { if (e.seekTime != null) this.seek(e.seekTime); },
    };
    // No seekbackward/seekforward: when they're set, iOS shows ±10 s on the lock screen instead of previous/next.
    for (const [k, fn] of Object.entries(h)) { try { ms.setActionHandler(k, fn); } catch { /* unsupported */ } }
  },
};

/* ================= Actions ================= */

async function albumSongs(id) {
  const r = await API.call('getAlbum', { id }, { cache: 5 * MIN });
  return { album: r.album, songs: register(r.album.song || []) };
}
async function artistSongs(id) {
  const r = await API.call('getArtist', { id }, { cache: 5 * MIN });
  const list = r.artist.album || [];
  const all = await Promise.all(list.map((a) => albumSongs(a.id).then((x) => x.songs).catch(() => [])));
  return all.flat();
}
async function playlistSongs(id) {
  const r = await API.call('getPlaylist', { id });
  return register(r.playlist.entry || []);
}
async function randomSongs(extra = {}) {
  const r = await API.call('getRandomSongs', { size: 100, ...extra });
  return register(r.randomSongs?.song || []);
}

async function toggleStar(id, kind = 'song') {
  const s = Songs.get(id);
  const on = kind === 'song' ? !s?.starred : !UI.starredAlbums.has(id);
  const param = kind === 'album' ? { albumId: id } : kind === 'artist' ? { artistId: id } : { id };
  try {
    await API.call(on ? 'star' : 'unstar', param);
    if (kind === 'song' && s) s.starred = on ? new Date().toISOString() : undefined;
    if (kind === 'album') { if (on) UI.starredAlbums.add(id); else UI.starredAlbums.delete(id); }
    API.bust();
    $$(`[data-act="star"][data-id="${CSS.escape(id)}"], [data-act="star-album"][data-id="${CSS.escape(id)}"]`).forEach((b) => {
      b.classList.toggle('on', on);
      if (b.classList.contains('t-heart')) b.innerHTML = heartIcon(on);
      else if (b.dataset.act === 'star-album') b.innerHTML = `${heartIcon(on)}${on ? 'Favorited' : 'Favorite'}`;
    });
    if (Player.current()?.id === id) UI.syncPlayer();
    toast(on ? 'Added to Favorites' : 'Removed from Favorites');
  } catch (e) { toast(e.message); }
}

async function run(fn) {
  try { await fn(); } catch (e) { toast(e.message || 'Something went wrong.'); }
}

/* ================= Menu ================= */

const Menu = {
  el: null,
  open(anchor, items) {
    const m = $('#menu');
    m.innerHTML = items.map((it) => it === '-' ? '<hr>' : `<button role="menuitem" data-mi="${it.key}">${it.icon ? icon(it.icon) : ''}${esc(it.label)}</button>`).join('');
    m.hidden = false;
    this.items = items;
    const r = anchor.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let x = r.right - mw, y = r.bottom + 6;
    if (x < 8) x = 8;
    if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 6);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    m.querySelector('button')?.focus({ preventScroll: true });
  },
  close() { $('#menu').hidden = true; this.items = null; },
  pick(key) {
    const it = this.items?.find((x) => x !== '-' && x.key === key);
    this.close();
    if (it) run(it.run);
  },
};

function songMenu(anchor, s) {
  const items = [
    { key: 'next', label: 'Play Next', icon: 'playNext', run: () => { Player.playNext(s); toast('Playing next'); } },
    { key: 'queue', label: 'Add to Queue', icon: 'addQueue', run: () => { Player.addToQueue(s); toast('Added to queue'); } },
    { key: 'radio', label: 'Start Radio', icon: 'radio', run: () => window.Radio.start('song', s) },
    '-',
    { key: 'star', label: s.starred ? 'Remove from Favorites' : 'Add to Favorites', icon: 'heart', run: () => toggleStar(s.id) },
    '-',
  ];
  if (s.albumId) items.push({ key: 'album', label: 'Go to Album', icon: 'album', run: () => { location.hash = '#/album/' + s.albumId; } });
  if (s.artistId) items.push({ key: 'artist', label: 'Go to Artist', icon: 'artist', run: () => { location.hash = '#/artist/' + s.artistId; } });
  if (items[items.length - 1] === '-') items.pop();
  Menu.open(anchor, items);
}

/* ================= Views ================= */

const View = {};

View.home = async (main) => {
  const today = new Date();
  main.innerHTML = `<header class="masthead">
      <h1 class="mast-title cond">Maré</h1>
      <div class="mast-issue"><span class="label" id="mast-kicker">From your library</span><span class="when" id="mast-when">${esc(today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span></div>
    </header>
    <section class="front skel-front" id="front"><div class="feature"><div class="art skel"></div></div><div class="chart"></div></section>
    <div class="mixes" id="mixes">${'<div class="mix skel"></div>'.repeat(3)}</div>
    <div id="home-discover"></div>
    <div id="home-rest">${section('Recently Played', skeletonShelf())}${section('Recently Added', skeletonShelf())}</div>`;

  window.Discover?.home($('#home-discover')).catch(() => {});
  const weekly = window.Discover?.weekly ? window.Discover.weekly().catch(() => null) : Promise.resolve(null);
  const [recent, newest, frequent, random, starred, genres, highest] = await Promise.all([
    albums('recent', 24).catch(() => []),
    albums('newest', 24).catch(() => []),
    albums('frequent', 60).catch(() => []),
    albums('random', 24).catch(() => []),
    albums('starred', 24).catch(() => []),
    API.call('getGenres', {}, { cache: 10 * MIN }).then((r) => r.genres?.genre || []).catch(() => []),
    albums('highest', 24).then((l) => l.filter((a) => a.userRating)).catch(() => []),
  ]);
  if (UI.route.name !== 'home') return;
  const route = UI.route;
  weekly.then((w) => { if (UI.route === route) renderFront(w, { recent, newest, frequent }); });

  // Rediscover: albums you played a lot, but not lately.
  const recentIds = new Set(recent.map((a) => a.id));
  const rediscover = shuffleArr(frequent.filter((a) => !recentIds.has(a.id))).slice(0, 18);

  const pick4 = (arr) => shuffleArr(arr.filter((a) => a.coverArt)).slice(0, 4);
  const mixDefs = [
    { key: 'mix-library', title: 'Shuffle your library', sub: 'A random hundred from everything you own', covers: pick4(random.length ? random : newest) },
    { key: 'mix-favorites', title: 'Your Favorites', sub: 'Songs you\'ve hearted, shuffled', covers: pick4(starred.length ? starred : frequent) },
    { key: 'mix-new', title: 'Fresh in the library', sub: 'The latest albums you\'ve added', covers: pick4(newest) },
  ];
  $('#mixes').innerHTML = mixDefs.map((m) => `<button class="mix" data-act="${m.key}">
      <div class="mix-collage">${(m.covers.length ? Array.from({ length: 4 }, (_, k) => m.covers[k % m.covers.length]) : []).map((a) => `<img src="${esc(API.cover(a.coverArt, 120))}" alt="">`).join('')}</div>
      <span class="mix-kicker">Mix</span>
      <span class="mix-title">${esc(m.title)}</span>
      <span class="mix-sub">${esc(m.sub)}</span>
    </button>`).join('');
  $$('#mixes .mix').forEach((el, i) => {
    const c = mixDefs[i].covers[0];
    if (c) extractTint(API.cover(c.coverArt, 300)).then((rgb) => setColour(el, rgb, 'mix'));
  });

  const topGenres = genres.slice().sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0)).slice(0, 18);
  const decades = [];
  const yearNow = new Date().getFullYear();
  for (let d = Math.floor(yearNow / 10) * 10; d >= 1950; d -= 10) decades.push(d);

  let html = '';
  if (recent.length) html += section('Recently Played', shelf(recent), '#/albums?sort=recent');
  if (newest.length) html += section('Recently Added', shelf(newest), '#/albums?sort=newest');
  if (highest.length) {
    html += `<section class="section"><div class="section-head"><h2>Top Rated</h2><span class="head-links"><a href="#" data-act="mix-top">Play your 5-star songs</a><a href="#/albums?sort=highest">See all</a></span></div>${shelf(highest)}</section>`;
  }
  if (frequent.length) html += section('On Repeat', shelf(frequent.slice(0, 24)), '#/albums?sort=frequent');
  if (rediscover.length >= 4) html += section('Rediscover', shelf(rediscover));
  if (random.length) html += section('Something Different', shelf(random), '#/albums?sort=random');
  if (starred.length) html += section('Favorite Albums', shelf(starred), '#/favorites');
  if (topGenres.length) html += section('Genres', `<div class="chips">${topGenres.map((g) => `<a class="chip" href="#/genre/${encodeURIComponent(g.value)}">${esc(g.value)}</a>`).join('')}</div>`);
  html += section('Decades', `<div class="chips">${decades.map((d) => `<a class="chip" href="#/decade/${d}">${d}s</a>`).join('')}</div>`);
  if (!recent.length && !newest.length) html = `<div class="empty"><h3>Your library is empty</h3><p>Add music to Navidrome and run a scan, then come back here.</p></div>`;
  $('#home-rest').innerHTML = html;
};

/* The front page: one album, big, in its own colour; a numbered chart beside it.
   With ListenBrainz it's your week (w); without, it comes from Navidrome's play counts. */
function renderFront(w, { recent, newest, frequent }) {
  const box = $('#front');
  if (!box) return;
  const fmtDay = (ts, opts) => new Date(ts * 1000).toLocaleDateString(undefined, opts);
  let album, kicker, quote, strip = '', chartTitle, chart = '';
  if (w && (w.album || w.songs.length)) {
    const last = w.range === 'week';
    $('#mast-kicker').textContent = last ? 'Your last week in music' : 'Your week in music';
    if (w.from && w.to) {
      const a = fmtDay(w.from, { day: 'numeric', month: 'long' }), b = fmtDay(w.to - 1, { day: 'numeric', month: 'long', year: 'numeric' });
      $('#mast-when').textContent = `${a} – ${b}`;
    }
    album = w.album;
    kicker = last ? 'Your album of last week' : 'Your album of the week';
    if (album && w.albumPlays) quote = `You played it ${plural(w.albumPlays, 'time')} ${last ? 'last week' : 'this week'}.`;
    const span = last ? 'last week' : 'this week';
    const cells = [
      w.listens != null && [w.listens.toLocaleString(), `plays ${span}`],
      w.artists != null && [w.artists.toLocaleString(), w.artists === 1 ? 'artist' : 'artists'],
      w.releases != null && [w.releases.toLocaleString(), w.releases === 1 ? 'album' : 'albums'],
      w.genre && [w.genre, 'your top genre'],
    ].filter(Boolean);
    if (cells.length) strip = `<div class="feature-strip">${cells.map(([n, l]) => `<div><b>${esc(n)}</b>${esc(l)}</div>`).join('')}</div>`;
    if (w.songs.length) {
      chartTitle = `Your top ${w.songs.length === 1 ? 'song' : w.songs.length} ${span}`;
      const listId = newList(w.songs.map((x) => x.song));
      chart = w.songs.map((x, i) => `<button class="chart-row" data-act="play-row" data-list="${listId}" data-i="${i}" data-song="${esc(x.song.id)}">
          <span class="chart-no">${i + 1}</span><img loading="lazy" src="${esc(API.cover(x.song.coverArt, 120))}" alt="">
          <span><span class="chart-title">${esc(x.song.title)}</span><span class="chart-sub">${esc(x.song.artist || '')}${x.plays ? ` · ${plural(x.plays, 'play')}` : ''}</span></span></button>`).join('');
    }
  }
  if (!album) {
    const top = new Set(frequent.slice(0, 30).map((a) => a.id));
    album = recent.find((a) => top.has(a.id)) || recent[0] || frequent[0] || newest[0];
    if (!album) { box.remove(); return; }
    if (!kicker) kicker = top.has(album.id) ? 'On heavy rotation' : recent.includes(album) ? 'Recently played' : 'New in the library';
    if (!quote) quote = album.playCount ? `You've played it ${plural(album.playCount, 'time')} so far.` : 'Waiting for its first spin.';
  }
  if (!chart) {
    const list = frequent.filter((a) => a.playCount).slice(0, 5);
    if (list.length) {
      chartTitle = 'Your most played albums';
      chart = list.map((a, i) => `<a class="chart-row" href="#/album/${esc(a.id)}"><span class="chart-no">${i + 1}</span>
          <img loading="lazy" src="${esc(API.cover(a.coverArt, 120))}" alt="">
          <span><span class="chart-title">${esc(a.name)}</span><span class="chart-sub">${esc(a.artist || '')} · ${plural(a.playCount, 'play')}</span></span></a>`).join('');
    }
  }
  box.classList.remove('skel-front');
  box.innerHTML = `<div class="feature">
      <a class="art" href="#/album/${esc(album.id)}">${artImg(album.coverArt, 600, album.name)}</a>
      <div class="feature-text">
        <span class="label">${esc(kicker)}</span>
        <h2 class="feature-title cond"><a href="#/album/${esc(album.id)}">${esc(album.name)}</a></h2>
        ${album.artistId ? `<a class="feature-by" href="#/artist/${esc(album.artistId)}">` : '<span class="feature-by">'}${esc(album.artist || '')}${album.year ? ` · ${album.year}` : ''}${album.artistId ? '</a>' : '</span>'}
        <p class="feature-quote">${esc(quote || '')}</p>
        <button class="btn btn-primary" data-act="play-album" data-id="${esc(album.id)}">${icon('play')}Play the album</button>
      </div>
      ${strip}
    </div>
    <div class="chart">${chart ? `<span class="label">${esc(chartTitle)}</span>${chart}` : `<span class="label">Your chart</span><p class="front-note">Play some music and your most played albums will show up here.</p>`}</div>`;
  applyTint($('.feature', box), API.cover(album.coverArt, 300));
  markPlaying();
}

View.albums = async (main, params) => {
  const sorts = [
    ['newest', 'Recently Added'], ['recent', 'Recently Played'], ['frequent', 'Most Played'],
    ['highest', 'Top Rated'], ['alphabeticalByName', 'Title'], ['alphabeticalByArtist', 'Artist'], ['random', 'Random'],
  ];
  const sort = sorts.some(([k]) => k === params.get('sort')) ? params.get('sort') : (store.get('albumSort') || 'newest');
  main.innerHTML = `<div class="page-head"><h1 class="page-title">Albums</h1>
    <select class="select" id="album-sort" aria-label="Sort albums">${sorts.map(([k, l]) => `<option value="${k}"${k === sort ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="album-grid" class="grid"></div><div class="load-more"><button class="btn" id="more" hidden>Load more</button></div>`;
  $('#album-sort').onchange = (e) => { store.set('albumSort', e.target.value); location.hash = '#/albums?sort=' + e.target.value; };
  // Alphabetical sorts get record-shop dividers: a big letter wherever the first letter changes.
  const byLetter = sort === 'alphabeticalByName' ? (a) => a.name : sort === 'alphabeticalByArtist' ? (a) => a.artist : null;
  let letter = null;
  let offset = 0;
  const size = 60;
  const more = async () => {
    const list = await albums(sort, size, offset);
    if (UI.route.name !== 'albums') return;
    $('#album-grid').insertAdjacentHTML('beforeend', list.map((a) => {
      const l = byLetter && firstLetter(byLetter(a));
      const head = l && l !== letter ? `<h2 class="az-head">${esc(letter = l)}</h2>` : '';
      return head + albumCard(a);
    }).join(''));
    offset += list.length;
    $('#more').hidden = list.length < size || sort === 'random';
    if (!offset) $('#album-grid').outerHTML = '<div class="empty"><h3>No albums yet</h3></div>';
  };
  $('#more').onclick = () => run(more);
  await more();
};
const firstLetter = (s) => {
  const c = String(s || '').replace(/^(the|a|an)\s+/i, '').normalize('NFKD').trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
};

View.album = async (main, params, id) => {
  main.innerHTML = `<div class="sleeve"><div class="sleeve-front"><div class="art skel"></div></div><div class="sleeve-back"></div></div>`;
  const { album: a, songs } = await albumSongs(id);
  if (UI.route.id !== id) return;
  const starred = !!a.starred;
  if (starred) UI.starredAlbums.add(a.id); else UI.starredAlbums.delete(a.id);
  const total = songs.reduce((t, s) => t + (s.duration || 0), 0);
  const genre = a.genre || songs.find((s) => s.genre)?.genre;
  const meta = [a.year, genre].filter(Boolean).join(' · ');
  main.innerHTML = `<article class="sleeve">
      <header class="sleeve-front">
        <div class="art">${artImg(a.coverArt, 600, a.name)}</div>
        <div>
          <div class="detail-kicker">${a.isCompilation ? 'Compilation' : 'Album'}</div>
          <h1>${esc(a.name)}</h1>
          ${a.artistId ? `<a class="detail-artist" href="#/artist/${esc(a.artistId)}">${esc(a.artist)}</a>` : `<div class="detail-artist">${esc(a.artist || '')}</div>`}
          <div class="detail-meta">${esc(meta)}</div>
          ${typeof Rating !== 'undefined' ? `<div class="album-rate"><span class="label">Your rating</span>${Rating.stars(a.userRating || 0, `data-kind="album" data-id="${esc(a.id)}"`)}</div>` : ''}
        </div>
      </header>
      <div class="sleeve-back">
        <div class="detail-actions">
          <button class="btn btn-primary" data-act="play-album" data-id="${esc(a.id)}">${icon('play')}Play</button>
          <button class="btn" data-act="shuffle-album" data-id="${esc(a.id)}">${icon('shuffle')}Shuffle</button>
          <button class="btn btn-ghost${starred ? ' on' : ''}" data-act="star-album" data-id="${esc(a.id)}">${heartIcon(starred)}${starred ? 'Favorited' : 'Favorite'}</button>
          <button class="icon-btn" data-act="menu-album" data-id="${esc(a.id)}" aria-label="More">${icon('more')}</button>
        </div>
        ${trackRows(songs, { sides: true })}
        <p class="album-foot">${plural(songs.length, 'song')}, ${fmtLong(total)}${a.playCount ? ` · you've played it ${plural(a.playCount, 'time')}` : ''}${a.played ? `, last on ${esc(new Date(a.played).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}</p>
        <div class="liner" id="liner">${creditsHtml(a, songs)}${typeof specSheet === 'function' ? specSheet(songs) : ''}</div>
      </div>
    </article>
    <div id="album-more"></div>`;
  if (UI.vt) $('.sleeve-front .art', main).style.viewTransitionName = 'cover';
  applyTint($('.sleeve-front', main), API.cover(a.coverArt, 300));
  markPlaying();
  // Liner notes: Navidrome's album description (from its metadata agents), when there is one.
  API.call('getAlbumInfo2', { id }, { cache: 30 * MIN }).then((r) => {
    const box = $('#liner');
    const tmp = document.createElement('div'); tmp.innerHTML = r.albumInfo?.notes || '';
    $$('a', tmp).forEach((x) => x.remove());
    const text = tmp.textContent.replace(/\s+/g, ' ').trim();
    if (text && box && UI.route.id === id) box.insertAdjacentHTML('afterbegin', `<p class="liner-notes">${esc(text)}</p>`);
  }).catch(() => {});
  if (a.artistId) {
    API.call('getArtist', { id: a.artistId }, { cache: 5 * MIN }).then((r) => {
      const others = (r.artist.album || []).filter((x) => x.id !== a.id);
      if (others.length && UI.route.id === id) $('#album-more').innerHTML = section(`More by ${a.artist}`, shelf(others), `#/artist/${a.artistId}`);
    }).catch(() => {});
  }
};

// Credits, the way the back of a sleeve prints them. Only what the files actually say.
function creditsHtml(a, songs) {
  const out = [];
  const date = (d) => d && d.year ? new Date(d.year, (d.month || 1) - 1, d.day || 1)
    .toLocaleDateString(undefined, d.day ? { day: 'numeric', month: 'long', year: 'numeric' } : d.month ? { month: 'long', year: 'numeric' } : { year: 'numeric' }) : '';
  const rel = date(a.releaseDate), orig = date(a.originalReleaseDate);
  if (rel) out.push(['Released', rel]);
  if (orig && a.originalReleaseDate.year !== a.releaseDate?.year) out.push(['First released', orig]);
  const labels = (a.recordLabels || []).map((l) => l.name).filter(Boolean);
  if (labels.length) out.push([labels.length > 1 ? 'Labels' : 'Label', labels.join(', ')]);
  const genres = (a.genres || []).map((g) => g.name).filter(Boolean);
  if (genres.length > 1) out.push(['Genres', genres.join(', ')]);
  const names = {
    composer: 'Composer', lyricist: 'Lyrics', arranger: 'Arranger', conductor: 'Conductor', producer: 'Producer',
    engineer: 'Engineer', mixer: 'Mixed by', remixer: 'Remixer', director: 'Director', djmixer: 'DJ mix',
  };
  const roles = new Map();
  const add = (label, name) => { if (!name) return; if (!roles.has(label)) roles.set(label, new Set()); roles.get(label).add(name); };
  for (const s of songs) {
    if (s.contributors?.length) {
      for (const c of s.contributors) {
        const r = String(c.role || '').toLowerCase();
        if (r === 'performer') add(c.subRole ? c.subRole.charAt(0).toUpperCase() + c.subRole.slice(1) : 'Performer', c.artist?.name);
        else if (names[r]) add(names[r], c.artist?.name);
      }
    } else if (s.displayComposer) add('Composer', s.displayComposer);
  }
  for (const [label, set] of [...roles].slice(0, 12)) {
    const list = [...set];
    out.push([list.length > 1 && /er$/.test(label) ? label + 's' : label, list.length > 5 ? `${list.slice(0, 4).join(', ')} and ${list.length - 4} more` : list.join(', ')]);
  }
  return out.length ? `<dl class="credits">${out.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : '';
}

View.artists = async (main) => {
  main.innerHTML = `<h1 class="page-title">Artists</h1><div id="artist-grid">${skeletonShelf()}</div>`;
  const r = await API.call('getArtists', {}, { cache: 5 * MIN });
  if (UI.route.name !== 'artists') return;
  const list = (r.artists?.index || []).flatMap((i) => i.artist || []);
  $('#artist-grid').outerHTML = list.length ? grid(list, artistCard) : '<div class="empty"><h3>No artists yet</h3></div>';
};

View.artist = async (main, params, id) => {
  main.innerHTML = `<header class="profile"><div class="profile-text"></div><div class="profile-photo skel"></div></header>`;
  const r = await API.call('getArtist', { id }, { cache: 5 * MIN });
  if (UI.route.id !== id) return;
  const a = r.artist;
  const list = (a.album || []).slice().sort((x, y) => (y.year || 0) - (x.year || 0));
  const heroSrc = a.artistImageUrl || (a.coverArt ? API.cover(a.coverArt, 1200) : '') || (list[0] ? API.cover(list[0].coverArt, 1200) : '');
  // Group the discography by release type when the server knows it (Albums, EPs, Singles…).
  const typeOf = (x) => String(x.releaseTypes?.[0] || '').toLowerCase();
  const groups = [['album', 'Albums'], ['ep', 'EPs'], ['single', 'Singles'], ['live', 'Live'], ['compilation', 'Compilations']];
  let disco = '';
  if (list.some((x) => x.releaseTypes?.length)) {
    const used = new Set();
    for (const [k, title] of groups) {
      const g = list.filter((x) => typeOf(x) === k);
      g.forEach((x) => used.add(x));
      if (g.length) disco += section(title, grid(g, discCard));
    }
    const rest = list.filter((x) => !used.has(x));
    if (rest.length) disco += section(disco ? 'Other releases' : 'Discography', grid(rest, discCard));
  } else disco = section('Discography', grid(list, discCard));
  main.innerHTML = `<header class="profile">
      <div class="profile-text">
        <div class="detail-kicker">Artist · ${plural(list.length, 'album')}</div>
        <h1>${esc(a.name)}</h1>
        <div class="profile-acts">
          <button class="hero-play" data-act="play-artist" data-id="${esc(a.id)}" aria-label="Shuffle ${esc(a.name)}">${icon('play')}</button>
          <button class="hero-radio" data-act="radio-artist" data-id="${esc(a.id)}">${icon('radio')}Radio</button>
        </div>
      </div>
      <div class="profile-photo">${heroSrc ? `<img src="${esc(heroSrc)}" alt="">` : ''}</div>
    </header>
    <div class="profile-cols"><div id="artist-bio"></div><div id="artist-top"></div></div>
    ${disco}
    <div id="artist-similar"></div>`;
  applyTint($('.profile', main), API.cover(a.coverArt || list[0]?.coverArt, 300));

  // These depend on Navidrome's metadata agents (ListenBrainz / Last.fm); show them only when they return something.
  API.call('getTopSongs', { artist: a.name, count: 10 }, { cache: 30 * MIN }).then((t) => {
    const songs = t.topSongs?.song || [];
    if (songs.length && UI.route.id === id) $('#artist-top').innerHTML = section('Top Songs', trackRows(songs.slice(0, 10), { art: true, numbers: 'index' }));
    markPlaying();
  }).catch(() => {});
  API.call('getArtistInfo2', { id, count: 12 }, { cache: 30 * MIN }).then((info) => {
    if (UI.route.id !== id) return;
    const i = info.artistInfo2 || {};
    const sim = i.similarArtist || [];
    if (sim.length) $('#artist-similar').innerHTML = section('Similar Artists in Your Library', shelf(sim, artistCard));
    if (i.biography) {
      const tmp = document.createElement('div'); tmp.innerHTML = i.biography;
      $$('a', tmp).forEach((x) => x.remove());
      const text = tmp.textContent.replace(/\s+/g, ' ').trim();
      if (text) {
        $('#artist-bio').innerHTML = section('Profile', `<p class="bio${text.length > 700 ? ' clamped' : ''}">${esc(text)}</p>${text.length > 700 ? '<button class="bio-more" data-act="bio-more">Read more</button>' : ''}`);
      }
    }
  }).catch(() => {});
};

// Discography card: the year leads, like a catalogue listing.
function discCard(a) {
  return `<a class="card" href="#/album/${esc(a.id)}">
    <div class="art">${artImg(a.coverArt, 300)}
      <button class="art-play" data-act="play-album" data-id="${esc(a.id)}" aria-label="Play ${esc(a.name)}">${icon('play')}</button>
    </div>
    ${a.year ? `<div class="card-year">${a.year}</div>` : ''}
    <div class="card-title">${esc(a.name)}</div>
  </a>`;
}

View.songs = async (main) => {
  main.innerHTML = `<div class="page-head"><h1 class="page-title">Songs</h1>
    <button class="btn btn-primary" data-act="mix-library">${icon('shuffle')}Shuffle all</button></div>
    <div id="song-list"></div><div class="load-more"><button class="btn" id="more" hidden>Load more</button></div>`;
  let offset = 0;
  const size = 100;
  const more = async () => {
    const r = await API.call('search3', { query: '', songCount: size, songOffset: offset, albumCount: 0, artistCount: 0 });
    if (UI.route.name !== 'songs') return;
    const songs = r.searchResult3?.song || [];
    $('#song-list').insertAdjacentHTML('beforeend', trackRows(songs, { art: true, numbers: 'index' }));
    offset += songs.length;
    $('#more').hidden = songs.length < size;
    markPlaying();
  };
  $('#more').onclick = () => run(more);
  await more();
};

View.playlists = async (main) => {
  main.innerHTML = `<h1 class="page-title">Playlists</h1><div id="pl"></div>`;
  const r = await API.call('getPlaylists', {}, { cache: MIN });
  if (UI.route.name !== 'playlists') return;
  const list = r.playlists?.playlist || [];
  $('#pl').outerHTML = list.length ? grid(list, playlistCard) : '<div class="empty"><h3>No playlists yet</h3><p>Playlists you make in Navidrome show up here.</p></div>';
};

View.playlist = async (main, params, id) => {
  main.innerHTML = `<div class="detail"><div class="art skel"></div><div></div></div>`;
  const r = await API.call('getPlaylist', { id });
  if (UI.route.id !== id) return;
  const p = r.playlist;
  const songs = p.entry || [];
  main.innerHTML = `<header class="detail">
      <div class="art">${artImg(p.coverArt, 600, p.name)}</div>
      <div>
        <div class="detail-kicker">Playlist</div>
        <h1>${esc(p.name)}</h1>
        <div class="detail-meta">${esc(p.comment || '')}${p.comment ? ' · ' : ''}${plural(songs.length, 'song')}, ${fmtLong(p.duration)}</div>
        <div class="detail-actions">
          <button class="btn btn-primary" data-act="play-playlist" data-id="${esc(p.id)}">${icon('play')}Play</button>
          <button class="btn" data-act="shuffle-playlist" data-id="${esc(p.id)}">${icon('shuffle')}Shuffle</button>
        </div>
      </div>
    </header>
    ${songs.length ? trackRows(songs, { art: true, numbers: 'index' }) : '<div class="empty"><h3>This playlist is empty</h3></div>'}`;
  applyTint($('.detail', main), API.cover(p.coverArt, 300));
  markPlaying();
};

View.favorites = async (main) => {
  main.innerHTML = `<h1 class="page-title">Favorites</h1><div id="fav"></div>`;
  const r = await API.call('getStarred2');
  if (UI.route.name !== 'favorites') return;
  const s = r.starred2 || {};
  const songs = s.song || [], al = s.album || [], ar = s.artist || [];
  al.forEach((a) => UI.starredAlbums.add(a.id));
  let html = '';
  if (songs.length) html += section('Songs', `<div class="detail-actions" style="margin-bottom:6px">
      <button class="btn btn-primary" data-act="mix-favorites">${icon('shuffle')}Shuffle favorites</button></div>
      ${trackRows(songs, { art: true, numbers: 'index' })}`);
  if (al.length) html += section('Albums', shelf(al));
  if (ar.length) html += section('Artists', shelf(ar, artistCard));
  $('#fav').innerHTML = html || '<div class="empty"><h3>No favorites yet</h3><p>Tap the heart on any song or album to save it here.</p></div>';
  markPlaying();
};

View.genre = async (main, params, name) => {
  name = decodeURIComponent(name);
  main.innerHTML = `<div class="page-head"><h1 class="page-title">${esc(name)}</h1>
    <div class="detail-actions"><button class="btn btn-primary" data-act="radio-genre" data-id="${esc(name)}">${icon('radio')}${esc(name)} Radio</button></div></div><div id="g"></div>`;
  const list = await albums('byGenre', 120, 0, { genre: name });
  if (UI.route.id !== encodeURIComponent(name) && UI.route.id !== name) return;
  $('#g').outerHTML = list.length ? grid(list) : '<div class="empty"><h3>No albums in this genre</h3></div>';
};

View.decade = async (main, params, start) => {
  const from = parseInt(start, 10) || 2000, to = from + 9;
  main.innerHTML = `<div class="page-head"><h1 class="page-title">The ${from}s</h1>
    <div class="detail-actions"><button class="btn btn-primary" data-act="radio-decade" data-id="${from}">${icon('radio')}${from}s Radio</button></div></div><div id="d"></div>`;
  const list = await albums('byYear', 200, 0, { fromYear: from, toYear: to });
  if (UI.route.id !== start) return;
  $('#d').outerHTML = list.length ? grid(shuffleArr(list).slice(0, 120)) : '<div class="empty"><h3>Nothing from this decade yet</h3></div>';
};

View.library = async (main) => {
  main.innerHTML = `<h1 class="page-title">Library</h1>
    <nav class="lib-links">
      <a href="#/playlists"><span class="ico">${icon('playlist')}</span>Playlists</a>
      <a href="#/artists"><span class="ico">${icon('artist')}</span>Artists</a>
      <a href="#/albums"><span class="ico">${icon('album')}</span>Albums</a>
      <a href="#/songs"><span class="ico">${icon('song')}</span>Songs</a>
      <a href="#/favorites"><span class="ico">${icon('heart')}</span>Favorites</a>
      <a href="#/settings"><span class="ico">${icon('settings')}</span>Settings</a>
    </nav>
    <div id="lib-recent">${section('Recently Added', skeletonShelf())}</div>`;
  const list = await albums('newest', 24);
  if (UI.route.name !== 'library') return;
  $('#lib-recent').innerHTML = list.length ? section('Recently Added', grid(list), '#/albums?sort=newest') : '';
};

View.search = async (main, params) => {
  const q = params.get('q') || '';
  main.innerHTML = `<form class="search-big" id="search-form" role="search">
      <span class="ico">${icon('search')}</span>
      <input type="search" name="q" value="${esc(q)}" placeholder="Artists, albums, songs" aria-label="Search" autocomplete="off">
    </form><div id="results"></div>`;
  const input = $('#search-form input');
  const go = debounce((v) => {
    history.replaceState(null, '', '#/search' + (v ? '?q=' + encodeURIComponent(v) : ''));
    UI.route.params = new URLSearchParams(v ? 'q=' + v : '');
    run(() => searchResults(v));
  }, 250);
  input.addEventListener('input', (e) => go(e.target.value.trim()));
  $('#search-form').onsubmit = (e) => { e.preventDefault(); input.blur(); };
  if (!q) setTimeout(() => input.focus(), 50);
  await searchResults(q);
};

async function searchResults(q) {
  const box = $('#results');
  if (!box) return;
  if (!q) {
    const genres = await API.call('getGenres', {}, { cache: 10 * MIN }).then((r) => r.genres?.genre || []).catch(() => []);
    if (!$('#results')) return;
    const top = genres.slice().sort((a, b) => (b.albumCount || 0) - (a.albumCount || 0)).slice(0, 30);
    box.innerHTML = top.length ? section('Browse by Genre', `<div class="chips">${top.map((g) => `<a class="chip" href="#/genre/${encodeURIComponent(g.value)}">${esc(g.value)}</a>`).join('')}</div>`) : '';
    return;
  }
  const r = await API.call('search3', { query: q, artistCount: 12, albumCount: 18, songCount: 30 });
  if (($('#search-form input')?.value.trim() || '') !== q) return;
  const res = r.searchResult3 || {};
  // Navidrome matches anywhere in the name, in no useful order: put exact matches first, then names that start with
  // the search, then a word that does, then the rest; most played first within each.
  const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const fq = fold(q);
  const rank = (name) => { const n = fold(name); return n === fq ? 0 : n.startsWith(fq) ? 1 : (' ' + n).includes(' ' + fq) ? 2 : 3; };
  const order = (list, name) => list.map((x, i) => ({ x, i, r: rank(name(x)) }))
    .sort((a, b) => a.r - b.r || (b.x.playCount || 0) - (a.x.playCount || 0) || a.i - b.i).map((o) => o.x);
  const ar = order(res.artist || [], (a) => a.name), al = order(res.album || [], (a) => a.name), so = order(res.song || [], (s) => s.title);
  if (!ar.length && !al.length && !so.length) {
    box.innerHTML = `<div class="empty"><h3>No results for “${esc(q)}”</h3><p>Check the spelling or try a shorter search.</p></div>`;
    return;
  }
  // Top result: an exact artist match beats an album, which beats a song.
  const top = [ar[0] && { kind: 'artist', v: ar[0], r: rank(ar[0].name) }, al[0] && { kind: 'album', v: al[0], r: rank(al[0].name) },
    so[0] && { kind: 'song', v: so[0], r: rank(so[0].title) }].filter(Boolean).sort((a, b) => a.r - b.r)[0];
  const t = top.v;
  const topHtml = `<a class="top-result" href="${top.kind === 'artist' ? '#/artist/' + esc(t.id) : top.kind === 'album' ? '#/album/' + esc(t.id) : '#/album/' + esc(t.albumId)}">
      <div class="art${top.kind === 'artist' ? '" style="border-radius:50%' : ''}">${artImg(t.coverArt, 200)}</div>
      <div><h3>${esc(t.name || t.title)}</h3><p>${top.kind === 'artist' ? 'Artist' : top.kind === 'album' ? 'Album · ' + esc(t.artist) : 'Song · ' + esc(t.artist)}</p></div>
    </a>`;
  box.innerHTML = `<div class="search-split">
      ${section('Top Result', topHtml)}
      ${so.length ? section('Songs', trackRows(so.slice(0, 6), { art: true, album: false, numbers: 'index' })) : '<div></div>'}
    </div>
    ${ar.length ? section('Artists', shelf(ar, artistCard)) : ''}
    ${al.length ? section('Albums', shelf(al)) : ''}
    ${so.length > 6 ? section('More Songs', trackRows(so.slice(6), { art: true, numbers: 'index' })) : ''}`;
  markPlaying();
}

/* ================= Router & UI ================= */

const UI = {
  route: { name: '', id: null, params: new URLSearchParams() },
  scrubbing: false,
  starredAlbums: new Set(),
  npView: 'art',

  parse() {
    const raw = location.hash.replace(/^#\/?/, '') || 'home';
    const [path, qs = ''] = raw.split('?');
    const [name, ...rest] = path.split('/');
    return { name: name || 'home', id: rest.join('/') || null, params: new URLSearchParams(qs) };
  },

  async render() {
    const r = this.parse();
    const view = View[r.name] || View.home;
    this.route = r;
    Menu.close();
    const main = $('#main');
    $$('[data-nav]').forEach((a) => {
      const n = a.dataset.nav;
      const libNames = ['albums', 'artists', 'songs', 'playlists', 'playlist', 'favorites', 'library', 'album', 'artist'];
      const active = n === r.name || (n === 'library' && libNames.includes(r.name) && a.closest('.tabbar'))
        || (n === 'playlists' && r.name === 'playlist') || (n === 'albums' && r.name === 'album' && !a.closest('.tabbar')) || (n === 'artists' && r.name === 'artist' && !a.closest('.tabbar'));
      a.classList.toggle('active', !!active);
    });
    main.scrollTop = 0;
    // Page turn: a short slide when the page changes (not when the same page refreshes).
    const path = r.name + '/' + (r.id || '');
    const turned = path !== this.lastPath;
    this.lastPath = path;
    // Cover grows into the album page, where the browser supports view transitions.
    const img = this.coverFrom;
    this.coverFrom = null;
    let p;
    const start = () => { p = view(main, r.params, r.id); return p; };
    if (img && img.isConnected && r.name === 'album' && document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      img.style.viewTransitionName = 'cover';
      this.vt = true;
      const vt = document.startViewTransition(async () => {
        start();
        await Promise.race([p.catch(() => {}), new Promise((res) => setTimeout(res, 320))]);
        const art = $('.sleeve-front .art', main);
        if (art) art.style.viewTransitionName = 'cover';
      });
      vt.finished.finally(() => { this.vt = false; $$('[style*="view-transition-name"]').forEach((e) => { e.style.viewTransitionName = ''; }); });
      await vt.updateCallbackDone.catch(() => {});
    } else {
      if (turned) { main.classList.remove('turn'); void main.offsetWidth; main.classList.add('turn'); }
      start();
    }
    try { await p; }
    catch (e) {
      if (e.code === 40 || e.code === 41) { this.logout(); return; }
      main.innerHTML = `<div class="empty"><h3>Couldn't load this page</h3><p>${esc(e.message)}</p><button class="btn" data-act="reload">Try again</button></div>`;
    }
  },

  syncPlayer() {
    const s = Player.current();
    const a = Player.audio;
    const playing = !a.paused;
    $$('.p-toggle, .p-mini-toggle').forEach((b) => { b.innerHTML = icon(playing ? 'pause' : 'play'); b.setAttribute('aria-label', playing ? 'Pause' : 'Play'); });
    $$('.p-shuffle').forEach((b) => { b.innerHTML = icon('shuffle'); b.classList.toggle('on', Player.shuffle); b.setAttribute('aria-pressed', Player.shuffle); });
    $$('.p-repeat').forEach((b) => { b.innerHTML = icon(Player.repeat === 'one' ? 'repeat1' : 'repeat'); b.classList.toggle('on', Player.repeat !== 'off'); });
    $$('.p-heart, .np-heart').forEach((b) => { b.innerHTML = heartIcon(!!s?.starred); b.classList.toggle('on', !!s?.starred); b.hidden = !s; });
    $$('.volume').forEach((v) => { v.value = Math.round(Player.vol * 100); v.style.setProperty('--p', Player.vol * 100 + '%'); });
    $('#np').classList.toggle('is-paused', !playing);
    $('#app').classList.toggle('idle', !s);

    const key = s ? s.id : '';
    if (this.lastSong !== key) {
      this.lastSong = key;
      const art = s ? API.cover(s.coverArt, 600) : '';
      $('.p-art').src = s ? API.cover(s.coverArt, 120) : '';
      $('.p-title').textContent = s ? s.title : 'Not playing';
      $('.p-artist').textContent = s ? s.artist || '' : '';
      $('.np-art').src = art;
      $('.np-bg img').src = art;
      $('.np-title').textContent = s ? s.title : '';
      const npA = $('.np-artist');
      npA.textContent = s ? `${s.artist || ''}${s.album ? ' — ' + s.album : ''}` : '';
      npA.href = s?.artistId ? '#/artist/' + s.artistId : '#';
      applyTint($('#np'), art);
      window.Lyrics?.onSong(s);
      document.title = s ? `${s.title} · ${s.artist || ''}` : 'Maré';
      if ('mediaSession' in navigator && s) {
        const abs = (u) => new URL(u, location.href).href;
        navigator.mediaSession.metadata = new MediaMetadata({
          title: s.title, artist: s.artist || '', album: s.album || '',
          artwork: [256, 512].map((n) => ({ src: abs(API.cover(s.coverArt, n)), sizes: `${n}x${n}`, type: 'image/jpeg' })),
        });
      }
    }
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = s ? (playing ? 'playing' : 'paused') : 'none';
    this.renderQueue();
    markPlaying();
  },

  renderQueue() {
    const box = $('#np-queue');
    if ($('#np').hidden) return;
    const q = Player.queue, cur = Player.index;
    if (!q.length) { box.innerHTML = '<h3>Up Next</h3><p class="hint">Your queue is empty.</p>'; return; }
    const start = Math.max(0, cur - 2);
    const shown = q.slice(start, start + 150);
    const radio = window.Radio?.label();
    box.innerHTML = `<h3>Up Next</h3><p class="hint">${radio ? `Playing ${esc(radio)} · more songs are added as you listen` : `${Player.shuffle ? 'Shuffling · ' : ''}${plural(q.length - cur - 1, 'song')} after this one`}</p>` +
      shown.map((s, k) => {
        const i = start + k;
        return `<div class="q-item${i === cur ? ' current' : ''}${i < cur ? ' past' : ''}" data-act="jump" data-i="${i}">
          <img loading="lazy" src="${esc(API.cover(s.coverArt, 88))}" alt="">
          <div class="t-main"><div class="t-title">${esc(s.title)}</div><div class="t-sub">${esc(s.artist || '')}</div></div>
          ${i > cur ? `<button class="q-remove" data-act="q-remove" data-i="${i}" aria-label="Remove from queue">${icon('x')}</button>` : '<span></span>'}
        </div>`;
      }).join('');
    const curEl = $('.q-item.current', box);
    if (curEl && this.queueJustOpened) { box.scrollTop = curEl.offsetTop - 60; this.queueJustOpened = false; }
  },

  openNP(view) {
    const np = $('#np');
    if (!Player.current()) return;
    np.classList.remove('closing');
    np.hidden = false;
    this.setNPView(view || this.npView);
    this.queueJustOpened = true;
    this.renderQueue();
    if (window.Lyrics) { window.Lyrics.pending = false; window.Lyrics.onSong(Player.current()); }
    if (!history.state?.np) history.pushState({ np: true }, '', location.hash);
  },
  closeNP(fromPop) {
    const np = $('#np');
    if (np.hidden) return;
    np.classList.add('closing');
    setTimeout(() => { np.hidden = true; np.classList.remove('closing'); }, 230);
    if (!fromPop && history.state?.np) history.back();
  },
  setNPView(v) {
    if (v === 'art' && matchMedia('(min-width: 1001px)').matches) v = this.npSide || 'queue';
    if (v !== 'art') this.npSide = v;
    this.npView = v;
    $('#np').classList.toggle('view-queue', v === 'queue');
    $('#np').classList.toggle('view-lyrics', v === 'lyrics');
    if (v === 'lyrics') window.Lyrics?.onTime(Player.pos(), true);
    $$('.np-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  },

  logout() {
    Player.els.forEach((el) => { el.pause(); el.removeAttribute('src'); });
    API.clear();
    store.del('player');
    store.del('catalog');
    location.hash = '#/home';
    location.reload();
  },

  async loadSidebarPlaylists() {
    try {
      const r = await API.call('getPlaylists', {}, { cache: MIN });
      const list = r.playlists?.playlist || [];
      $('#side-playlists').innerHTML = list.slice(0, 30).map((p) => `<a href="#/playlist/${esc(p.id)}" title="${esc(p.name)}">${esc(p.name)}</a>`).join('');
    } catch { /* ignore */ }
  },
};

/* ================= Event wiring ================= */

const actions = {
  'play-row': async (el) => {
    const list = Lists.get(el.dataset.list);
    if (list) Player.playList(list, +el.dataset.i);
  },
  'play-album': async (el) => { const { songs } = await albumSongs(el.dataset.id); Player.playList(songs, 0, { shuffle: false }); },
  'shuffle-album': async (el) => { const { songs } = await albumSongs(el.dataset.id); Player.playList(songs, 0, { shuffle: true }); },
  'play-artist': async (el) => { toast('Starting artist shuffle…'); Player.playList(await artistSongs(el.dataset.id), 0, { shuffle: true }); },
  'play-playlist': async (el) => { Player.playList(await playlistSongs(el.dataset.id), 0, { shuffle: false }); },
  'shuffle-playlist': async (el) => { Player.playList(await playlistSongs(el.dataset.id), 0, { shuffle: true }); },
  'mix-library': async () => { Player.playList(await randomSongs(), 0, { shuffle: true }); },
  'mix-favorites': async () => {
    const r = await API.call('getStarred2');
    const songs = r.starred2?.song || [];
    if (songs.length) Player.playList(songs, 0, { shuffle: true });
    else Player.playList(await randomSongs(), 0, { shuffle: true });
  },
  'mix-new': async () => {
    const list = await albums('newest', 12);
    const all = (await Promise.all(list.map((a) => albumSongs(a.id).then((x) => x.songs).catch(() => [])))).flat();
    Player.playList(all, 0, { shuffle: true });
  },
  'mix-genre': async (el) => { Player.playList(await randomSongs({ genre: el.dataset.id }), 0, { shuffle: true }); },
  'mix-decade': async (el) => { const f = +el.dataset.id; Player.playList(await randomSongs({ fromYear: f, toYear: f + 9 }), 0, { shuffle: true }); },
  star: (el) => toggleStar(el.dataset.id),
  'star-album': (el) => toggleStar(el.dataset.id, 'album'),
  'star-current': () => { const s = Player.current(); if (s) return toggleStar(s.id); },
  'menu-song': (el) => { const s = Songs.get(el.dataset.id); if (s) songMenu(el, s); },
  'menu-current': (el) => { const s = Player.current(); if (s) songMenu(el, s); },
  'menu-album': (el) => Menu.open(el, [
    { key: 'next', label: 'Play Next', icon: 'playNext', run: async () => { Player.playNext((await albumSongs(el.dataset.id)).songs); toast('Album plays next'); } },
    { key: 'queue', label: 'Add to Queue', icon: 'addQueue', run: async () => { Player.addToQueue((await albumSongs(el.dataset.id)).songs); toast('Album added to queue'); } },
    { key: 'radio', label: 'Start Radio', icon: 'radio', run: async () => window.Radio.start('album', (await albumSongs(el.dataset.id)).album) },
  ]),
  toggle: () => Player.toggle(),
  next: () => Player.next(),
  prev: () => Player.prev(),
  shuffle: () => Player.toggleShuffle(),
  repeat: () => Player.cycleRepeat(),
  'open-np': () => UI.openNP('art'),
  'open-queue': () => UI.openNP('queue'),
  'close-np': () => UI.closeNP(),
  'np-view': (el) => UI.setNPView(el.dataset.view),
  jump: (el) => Player.jump(+el.dataset.i),
  'q-remove': (el) => Player.removeAt(+el.dataset.i),
  logout: () => UI.logout(),
  reload: () => UI.render(),
  'bio-more': (el) => { const b = el.previousElementSibling; b?.classList.toggle('clamped'); el.textContent = b?.classList.contains('clamped') ? 'Read more' : 'Show less'; },
};

// Remember which cover was clicked, so it can grow into the album page.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/album/"]');
  UI.coverFrom = a && !e.target.closest('[data-act]') ? $('.art img', a) || (a.matches('.art') ? $('img', a) : null) : null;
}, true);

document.addEventListener('click', (e) => {
  const mi = e.target.closest('[data-mi]');
  if (mi) { Menu.pick(mi.dataset.mi); return; }
  if (!e.target.closest('#menu')) Menu.close();
  if (e.target.closest('[data-stop]')) return;           // plain links inside rows
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  e.stopPropagation();
  run(() => fn(el));
});

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range';
  if (e.key === 'Escape') { if (!$('#menu').hidden) Menu.close(); else UI.closeNP(); return; }
  if (e.key === 'Enter' && e.target.matches('.p-now')) { UI.openNP('art'); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' && !e.target.closest('button, a')) { e.preventDefault(); Player.toggle(); }
  else if (e.key === 'ArrowRight' && e.shiftKey) Player.next();
  else if (e.key === 'ArrowLeft' && e.shiftKey) Player.prev();
  else if (e.key === '/') { e.preventDefault(); const i = $('#side-search input'); if (i && i.offsetParent) i.focus(); else location.hash = '#/search'; }
});

function wireRanges() {
  $$('.scrubber').forEach((r) => {
    const preview = () => {
      const f = r.value / 1000, d = Player.dur();
      r.style.setProperty('--p', f * 100 + '%');
      $$('.p-cur').forEach((x) => { x.textContent = fmtTime(f * d); });
    };
    r.addEventListener('input', () => { UI.scrubbing = true; preview(); });
    // Browsers skip "change" when the bar is let go where it started, or when a drag is interrupted; without the
    // fallbacks the progress bar stayed frozen (at 0:00 on every next song) while the music played on.
    const done = () => { if (!UI.scrubbing) return; UI.scrubbing = false; Player.seekFraction(r.value / 1000); };
    r.addEventListener('change', done);
    ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'].forEach((ev) => r.addEventListener(ev, () => setTimeout(done, 0)));
  });
  $$('.volume').forEach((v) => {
    v.addEventListener('input', () => { Player.setVolume(v.value / 100); UI.syncPlayer(); });
    v.addEventListener('change', () => Player.persist());
  });
}

$('#side-search').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = e.target.q.value.trim();
  location.hash = '#/search' + (q ? '?q=' + encodeURIComponent(q) : '');
});
$('#side-search input').addEventListener('input', debounce((e) => {
  const q = e.target.value.trim();
  if (q.length >= 2) location.hash = '#/search?q=' + encodeURIComponent(q);
}, 400));

window.addEventListener('hashchange', () => {
  if (!$('#np').hidden) { $('#np').hidden = true; }
  UI.render();
});
window.addEventListener('popstate', (e) => { if (!e.state?.np) UI.closeNP(true); });
window.addEventListener('resize', () => Menu.close());
$('#main').addEventListener('scroll', () => Menu.close(), { passive: true });

/* Swipe down to close Now Playing on touch screens */
(() => {
  const np = $('#np');
  let y0 = null, dy = 0;
  np.addEventListener('touchstart', (e) => {
    if (e.target.closest('input, .np-queue')) { y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  np.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.touches[0].clientY - y0);
    np.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  np.addEventListener('touchend', () => {
    if (y0 == null) return;
    np.style.transform = '';
    if (dy > 120) UI.closeNP();
    y0 = null;
  });
})();

/* ================= Boot ================= */

function showLogin(msg) {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#login-error').textContent = msg || '';
  const f = $('#login-form');
  if (API.base) f.server.value = API.base;
  f.user.focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type="submit"]', f);
  btn.disabled = true; btn.textContent = 'Signing in…';
  $('#login-error').textContent = '';
  try {
    await API.login(f.server.value, f.user.value, f.pass.value);
    f.pass.value = '';
    start();
  } catch (err) {
    $('#login-error').textContent = err.code === 40 ? 'Wrong username or password.' : err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

function start() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  paintIcons();
  $$('.np-close').forEach((b) => { b.innerHTML = icon('down'); });
  $$('.np-more').forEach((b) => { b.innerHTML = icon('more'); });
  $$('[data-act="prev"]').forEach((b) => { b.innerHTML = icon('prev'); });
  $$('[data-act="next"]').forEach((b) => { b.innerHTML = icon('next'); });
  $$('[data-act="open-queue"]').forEach((b) => { b.innerHTML = icon('queue'); });
  if (!start.done) { Player.init(); wireRanges(); start.done = true; }
  UI.syncPlayer();
  UI.loadSidebarPlaylists();
  UI.render();
  window.Discover?.onStart?.();
  if (window.Catalog) setTimeout(() => window.Catalog.ensure().catch(() => {}), 4000);
}

// iPhone Home Screen app: iOS sometimes opens it with a page shorter than the screen, leaving a black band under
// the tabs. Measure the missing strip and let the docked bars and Now Playing reach down over it.
{
  const fix = () => {
    const ios = navigator.standalone === true, up = innerHeight > innerWidth;
    const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
    const gap = ios && up && !typing ? Math.max(0, Math.min(200, screen.height - innerHeight)) : 0;
    document.documentElement.style.setProperty('--ios-gap', gap + 'px');
  };
  fix();
  for (const e of ['resize', 'orientationchange', 'pageshow', 'focusout']) addEventListener(e, () => setTimeout(fix, 100));
}

(async function boot() {
  // Start only once every script has run (discover.js, extras.js… patch the UI); offline, the ping fails fast
  // enough to otherwise render before the offline handling exists.
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
  if (!API.load()) { showLogin(); return; }
  try { await API.call('ping'); start(); }
  catch (e) {
    if (e.code === 40 || e.code === 41) { API.clear(); showLogin('Your session expired. Sign in again.'); }
    else start();   // server unreachable: still show the shell, pages will show the error
  }
})();
