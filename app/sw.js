/* Maré service worker: keeps the app usable offline and plays downloaded songs. */
const VERSION = '1.5.8';
const SHELL = 'mare-shell-' + VERSION;
const AUDIO = 'mare-audio';
const ART = 'mare-art';
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
      try { return await fetch(req); } catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  if (path.startsWith('/rest/') || path.startsWith('/lb/') || path.startsWith('/mb/')) return;

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
