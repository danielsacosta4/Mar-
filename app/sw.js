/* Maré service worker: keeps the app usable offline and plays downloaded songs. */
const VERSION = '1.5.16';
const SHELL = 'mare-shell-' + VERSION;
const AUDIO = 'mare-audio';
const ART = 'mare-art';
const AHEAD = 'mare-ahead';    // the next few songs of the queue, saved while playing (managed by extras.js)
const COVERS = 'mare-covers';  // every cover seen, so pages show them instantly the next time
const PAGES = 'mare-pages';    // last answer of library reads, shown at once and refreshed in the background
const MAX_COVERS = 3000;
// Library reads worth showing from memory. Anything that changes data clears them (see CHANGES).
const PAGE_CALLS = new Set(['getAlbumList2', 'getAlbum', 'getArtists', 'getArtist', 'getArtistInfo2', 'getAlbumInfo2', 'getPlaylists', 'getPlaylist', 'getGenres', 'getStarred2', 'getTopSongs']);
const CHANGES = /^(create|update|delete)Playlist$|^(star|unstar|setRating|startScan)$/;
const SHELL_FILES = ['./', 'index.html', 'app.css', 'app.js', 'discover.js', 'extras.js', 'collection.js', 'shopping.js', 'timemachine.js', 'moments.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
// Fonts are fetched by the installer; if they're missing the app falls back to system fonts, so don't fail on them.
const FONT_FILES = ['fonts/archivo.woff2', 'fonts/newsreader.woff2', 'fonts/newsreader-italic.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then(async (c) => {
    await c.addAll(SHELL_FILES);
    await Promise.all(FONT_FILES.map((f) => c.add(f).catch(() => {})));
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mare-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

let coverPuts = 0;
async function trimCovers(cache) {
  if (++coverPuts % 100) return;
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_COVERS))) await cache.delete(k);
}

// Serve a cached file, honouring Range requests (audio elements always ask for ranges).
async function ranged(resp, range) {
  const blob = await resp.blob();
  const size = blob.size;
  const type = resp.headers.get('Content-Type') || 'audio/mpeg';
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  if (!m) return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' } });
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]);
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  // Songs: play the downloaded copy when there is one, otherwise stream from the server.
  if (/\/rest\/stream(\.view)?$/.test(path)) {
    const id = url.searchParams.get('id');
    e.respondWith((async () => {
      const hit = await (await caches.open(AUDIO)).match(`/offline/song/${id}`);
      if (hit) return ranged(hit, req.headers.get('Range'));
      if (!url.searchParams.get('timeOffset')) {
        const q = url.searchParams;
        const ahead = await (await caches.open(AHEAD)).match(`/ahead/${id}/${q.get('format') || ''}/${q.get('maxBitRate') || ''}`);
        if (ahead) return ranged(ahead, req.headers.get('Range'));
      }
      return fetch(req);
    })());
    return;
  }

  // Cover art: downloaded covers first (any size), then the server.
  if (/\/rest\/getCoverArt(\.view)?$/.test(path)) {
    const id = url.searchParams.get('id');
    e.respondWith((async () => {
      const hit = await (await caches.open(ART)).match(`/offline/art/${id}`);
      if (hit) return hit;
      const key = `/covers/${id}/${url.searchParams.get('size') || ''}`;
      const covers = await caches.open(COVERS);
      const seen = await covers.match(key);
      if (seen) return seen;
      try {
        const res = await fetch(req);
        if (res.ok) { covers.put(key, res.clone()).then(() => trimCovers(covers)); }
        return res;
      } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Library reads: answer from memory straight away and fetch a fresh copy for next time.
  const call = (/\/rest\/(\w+?)(\.view)?$/.exec(path) || [])[1];
  if (call && CHANGES.test(call)) { e.waitUntil(caches.delete(PAGES)); return; }
  if (call && PAGE_CALLS.has(call) && !(call === 'getAlbumList2' && url.searchParams.get('type') === 'random')) {
    const q = new URLSearchParams(url.searchParams);
    for (const k of ['u', 't', 's', 'p', 'v', 'c', 'f', '_']) q.delete(k);
    q.sort();
    const key = `/pages/${call}?${q}`;
    e.respondWith((async () => {
      const cache = await caches.open(PAGES);
      const fresh = fetch(req).then(async (res) => {
        if (res.ok) {
          const body = await res.clone().text();
          let ok = false;
          try { ok = JSON.parse(body)['subsonic-response']?.status === 'ok'; } catch { /* not JSON */ }
          if (ok) await cache.put(key, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
        }
        return res;
      });
      const seen = await cache.match(key);
      if (!seen) return fresh;
      e.waitUntil(fresh.catch(() => {}));
      // Offline fails within moments: then say so (the app shows its offline notice), still with the remembered page.
      const failed = await Promise.race([fresh.then(() => false, () => true), new Promise((r) => setTimeout(() => r(false), 300))]);
      if (!failed) return seen;
      return new Response(seen.body, { headers: { 'Content-Type': 'application/json', 'X-Mare-Offline': '1' } });
    })());
    return;
  }

  if (path.startsWith('/rest/') || path.startsWith('/lb/') || path.startsWith('/mb/') || path.startsWith('/mbo/')) return;

  // App files: network first so updates show up straight away, cache when offline.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok && (req.mode === 'navigate' || SHELL_FILES.some((f) => path.endsWith('/' + f.replace('./', ''))))) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('./') : Response.error());
    }
  })());
});
