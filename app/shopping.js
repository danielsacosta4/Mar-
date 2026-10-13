/* Maré — Round 5a: the shopping list. New releases from artists you listen to (ListenBrainz), each artist's
   discography against your library (MusicBrainz), and one list of everything missing. Loaded after collection.js. */
'use strict';

STROKE.bag = '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>';
const DAY = 24 * HOUR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = () => new Date().toISOString().slice(0, 10);

/* ================= MusicBrainz client ================= */
// Through the Maré container (/mb, which adds the User-Agent MusicBrainz asks for). MusicBrainz allows about one
// request per second, so requests queue up; answers are kept for a week in a compact form.

const MB = {
  base() { return API.base ? 'https://musicbrainz.org/ws/2' : '/mb'; },
  chain: Promise.resolve(),
  last: 0,
  get(path, params = {}) {
    const url = `${this.base()}/${path}?${new URLSearchParams({ ...params, fmt: 'json' })}`;
    const run = this.chain.then(async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const wait = this.last + 1100 - Date.now();
        if (wait > 0) await sleep(wait);
        this.last = Date.now();
        let res;
        try { res = await fetch(url, { headers: { Accept: 'application/json' } }); } catch { throw new ApiError('Can\'t reach MusicBrainz.', 0); }
        if (res.status === 503 || res.status === 429) { await sleep(2500 * (attempt + 1)); continue; }   // busy: back off and retry
        if (!res.ok) throw new ApiError(`MusicBrainz returned ${res.status}.`, res.status);
        return res.json();
      }
      throw new ApiError('MusicBrainz is busy. Try again in a minute.', 503);
    });
    this.chain = run.catch(() => {});
    return run;
  },
};

/* ================= Discographies ================= */

// Release kinds that count as "albums" for completing a discography. Live albums, compilations, soundtracks,
// remixes and the like are left out so the missing list doesn't fill with noise.
const SKIP_SECONDARY = new Set(['compilation', 'live', 'soundtrack', 'remix', 'dj-mix', 'mixtape/street', 'demo', 'interview', 'spokenword', 'audiobook', 'audio drama', 'field recording']);
const Hidden = {
  set() { return new Set(store.get('hidden') || []); },
  has(id) { return this.set().has(id); },
  add(id) { const s = this.set(); s.add(id); store.set('hidden', [...s]); },
  clear() { store.del('hidden'); },
  get size() { return this.set().size; },
};

// Same album? Names are normalised ("(Remastered)", "(Deluxe Edition)", "feat." … dropped); a library title that
// starts with the release's title also counts ("OK Computer OKNOTOK" ⊃ "OK Computer").
function sameAlbum(libName, title) {
  const a = norm(libName), b = norm(title);
  if (!a || !b) return false;
  return a === b || (b.length >= 4 && a.startsWith(b + ' '));
}

const Disco = {
  // The artist's MusicBrainz ID: from Navidrome when it knows it, otherwise a name search (exact names only).
  async artistMbid(a) {
    if (a.musicBrainzId) return a.musicBrainzId;
    const key = 'mb.artist.' + norm(a.name);
    const hit = store.get(key);
    if (hit && Date.now() - hit.t < 30 * DAY) return hit.id;
    const info = await API.call('getArtistInfo2', { id: a.id }, { cache: 30 * MIN }).then((r) => r.artistInfo2 || {}).catch(() => ({}));
    let id = info.musicBrainzId || null;
    if (!id) {
      const r = await MB.get('artist', { query: `artist:"${a.name.replace(/"/g, '')}"`, limit: 5 });
      const exact = (r.artists || []).filter((x) => norm(x.name) === norm(a.name) && (x.score ?? 100) >= 90);
      id = exact[0]?.id || null;
    }
    store.set(key, { t: Date.now(), id });
    return id;
  },

  // Albums and EPs (studio releases), oldest first: [{ id, title, type, date }]
  async releaseGroups(mbid) {
    const key = 'mb.rg.' + mbid;
    const hit = store.get(key);
    if (hit && Date.now() - hit.t < 7 * DAY) return hit.v;
    const out = [];
    for (let offset = 0; offset < 400; offset += 100) {
      const r = await MB.get('release-group', { artist: mbid, type: 'album|ep', limit: 100, offset });
      const list = r['release-groups'] || [];
      for (const g of list) {
        const sec = (g['secondary-types'] || []).map((x) => x.toLowerCase());
        if (sec.some((x) => SKIP_SECONDARY.has(x))) continue;
        out.push({ id: g.id, title: g.title, type: g['primary-type'] || 'Album', date: g['first-release-date'] || '' });
      }
      if (offset + list.length >= (r['release-group-count'] || 0) || list.length < 100) break;
    }
    out.sort((x, y) => (x.date || '9999').localeCompare(y.date || '9999'));
    store.set(key, { t: Date.now(), v: out });
    return out;
  },

  // { mbid, total, owned: [{rg, album}], missing: [rg] } for a Navidrome artist (getArtist result).
  async forArtist(a, albumsInLibrary) {
    const mbid = await this.artistMbid(a);
    if (!mbid) return null;
    const rgs = (await this.releaseGroups(mbid)).filter((g) => !g.date || g.date <= TODAY());
    const lib = albumsInLibrary || [];
    const owned = [], missing = [];
    for (const g of rgs) {
      const album = lib.find((x) => sameAlbum(x.name, g.title));
      if (album) owned.push({ rg: g, album });
      else if (!Hidden.has(g.id)) missing.push(g);
    }
    return { mbid, total: rgs.length, owned, missing };
  },
};

const caaGroup = (id) => `https://coverartarchive.org/release-group/${id}/front-250`;
const qobuzUrl = (artist, title) => `https://www.qobuz.com/pt-pt/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}`;
const yearOf = (d) => (d || '').slice(0, 4);

// A greyed-out card for an album that isn't in the library.
function missingCard({ id, title, artist, date, type, cover, when }) {
  return `<div class="card missing-card" data-rg="${esc(id)}">
    <div class="art"><div class="art-fallback">${icon('album')}</div>${cover ? `<img loading="lazy" src="${esc(cover)}" alt="" onerror="this.remove()">` : ''}</div>
    ${when ? `<div class="card-when">${esc(when)}</div>` : yearOf(date) ? `<div class="card-year">${esc(yearOf(date))}</div>` : ''}
    <div class="card-title">${esc(title)}</div>
    <div class="card-sub">${esc([artist, type && type !== 'Album' ? type : ''].filter(Boolean).join(' · '))}</div>
    <div class="miss-acts"><a class="miss-btn" href="${esc(qobuzUrl(artist, title))}" target="_blank" rel="noopener">Qobuz</a>
      <button class="miss-btn ghost" data-act="not-interested" data-id="${esc(id)}">Hide</button></div>
  </div>`;
}

/* ================= Artist pages: owned vs missing ================= */

{
  const orig = View.artist;
  View.artist = async (main, params, id) => {
    await orig(main, params, id);
    if (UI.route.id !== id || $('#artist-disco', main)) return;
    const r = await API.call('getArtist', { id }, { cache: 5 * MIN }).catch(() => null);
    if (!r || UI.route.id !== id) return;
    const a = r.artist;
    const box = document.createElement('div');
    box.id = 'artist-disco';
    $('#artist-similar', main)?.before(box);
    box.innerHTML = `<p class="section-note disco-wait">Checking ${esc(a.name)}'s discography on MusicBrainz…</p>`;
    const d = await Disco.forArtist(a, a.album || []).catch(() => null);
    if (UI.route.id !== id) return;
    if (!d || !d.total) { box.innerHTML = ''; return; }
    const have = d.owned.length;
    box.innerHTML = `<section class="section"><div class="section-head"><h2>Not in Your Library</h2><span class="disco-count">You have ${have} of ${plural(d.total, 'album')}</span></div>
      ${d.missing.length ? `<div class="grid">${d.missing.map((g) => missingCard({ ...g, artist: a.name, cover: caaGroup(g.id) })).join('')}</div>`
        : '<p class="section-note">You have the whole discography (studio albums and EPs).</p>'}</section>`;
    // The count also goes under the artist's name.
    $('.profile .detail-kicker', main)?.insertAdjacentHTML('beforeend', ` · you have ${have} of ${d.total}`);
  };
}

/* ================= New releases (ListenBrainz) ================= */

const Fresh = {
  async list() {
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get(`user/${encodeURIComponent(user)}/fresh_releases`, { days: 90, past: true, future: true, sort: 'release_date' }, { cache: 6 * HOUR });
    const seen = new Set();
    return (r?.payload?.releases || []).map((x) => ({
      id: x.release_group_mbid || x.release_mbid,
      title: x.release_name, artist: x.artist_credit_name, date: x.release_date || '',
      type: x.release_group_primary_type || '', sec: x.release_group_secondary_type || '',
      cover: x.caa_id && x.caa_release_mbid ? `https://coverartarchive.org/release/${x.caa_release_mbid}/${x.caa_id}-250.jpg` : (x.release_group_mbid ? caaGroup(x.release_group_mbid) : ''),
    })).filter((x) => x.id && x.title && !seen.has(x.id) && seen.add(x.id));
  },
  owned: new Map(),
  // Is it in the library? (library albums by name + artist; cached for the session)
  async check(list) {
    let i = 0;
    const worker = async () => {
      while (i < list.length) {
        const x = list[i++];
        if (!this.owned.has(x.id)) this.owned.set(x.id, await Match.album(x.title, x.artist).catch(() => null));
        x.album = this.owned.get(x.id);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return list;
  },
};
const whenLabel = (date) => {
  if (!date) return '';
  const d = new Date(date + 'T12:00:00');
  const s = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return date > TODAY() ? `Coming ${s}` : `Out ${s}`;
};
function freshCard(x) {
  if (x.album) {
    return albumCard(x.album).replace('<div class="card-title">', `<div class="card-when">${esc(whenLabel(x.date))} · in your library</div><div class="card-title">`);
  }
  return missingCard({ ...x, when: whenLabel(x.date) });
}

View.new = async (main, params) => {
  const show = params.get('show') || 'all';
  main.innerHTML = `<div class="page-head"><h1 class="page-title">New Releases</h1>
      <div class="chips">${[['all', 'All'], ['missing', 'Not in your library'], ['owned', 'In your library']].map(([k, l]) =>
        `<a class="chip${k === show ? ' on' : ''}" href="#/new${k === 'all' ? '' : '?show=' + k}">${l}</a>`).join('')}</div></div>
    <div id="new-list"><p class="section-note">Looking for new releases from the artists you listen to…</p></div>`;
  if (!LB.connected()) {
    $('#new-list').innerHTML = '<div class="empty"><h3>Connect ListenBrainz</h3><p>New releases come from the artists you listen to, so Maré needs your ListenBrainz account.</p><button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div>';
    return;
  }
  const list = (await Fresh.list()).filter((x) => !Hidden.has(x.id));
  if (UI.route.name !== 'new') return;
  await Fresh.check(list);
  if (UI.route.name !== 'new') return;
  const pick = list.filter((x) => show === 'all' || (show === 'owned' ? x.album : !x.album));
  const soon = pick.filter((x) => x.date > TODAY()).sort((a, b) => a.date.localeCompare(b.date));
  const out = pick.filter((x) => !(x.date > TODAY())).sort((a, b) => b.date.localeCompare(a.date));
  $('#new-list').innerHTML = (soon.length ? section('Coming Soon', `<div class="grid">${soon.map(freshCard).join('')}</div>`) : '')
    + (out.length ? section('Out Now', `<div class="grid">${out.map(freshCard).join('')}</div>`) : '')
    || '<div class="empty"><h3>Nothing new</h3><p>No releases in the last three months from the artists you listen to.</p></div>';
};

// Home: "New for You", right after the front page.
{
  const orig = Discover.home.bind(Discover);
  Discover.home = async (box) => {
    await orig(box);
    if (!LB.connected() || !box?.isConnected) return;
    const route = UI.route;
    const list = await Fresh.list().catch(() => []);
    const recent = list.filter((x) => !Hidden.has(x.id) && x.date && x.date <= TODAY()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
    if (!recent.length || UI.route !== route) return;
    await Fresh.check(recent);
    if (UI.route !== route || !box.isConnected) return;
    box.insertAdjacentHTML('afterbegin', section('New for You', `<div class="shelf">${recent.map(freshCard).join('')}</div>`, '#/new'));
  };
}

/* ================= Shopping list ================= */

View.shopping = async (main) => {
  main.innerHTML = `<div class="page-head"><h1 class="page-title">Shopping List</h1>
      ${Hidden.size ? `<button class="btn btn-link" data-act="unhide-all">Show ${plural(Hidden.size, 'hidden album')} again</button>` : ''}</div>
    <p class="section-note">Albums you don't have yet: new releases from artists you listen to, then what's missing from your favourite artists' discographies.</p>
    <div id="shop-new"></div><div id="shop-artists"></div>`;
  const live = () => UI.route.name === 'shopping';

  // New releases not in the library
  if (LB.connected()) {
    const list = (await Fresh.list().catch(() => [])).filter((x) => !Hidden.has(x.id));
    await Fresh.check(list);
    if (!live()) return;
    const missing = list.filter((x) => !x.album).sort((a, b) => b.date.localeCompare(a.date));
    if (missing.length) $('#shop-new').innerHTML = section('New Releases', `<div class="grid">${missing.map(freshCard).join('')}</div>`, '#/new?show=missing');
  }

  // Missing albums from the artists you play most (ListenBrainz all-time; otherwise Navidrome's most played)
  let artists = LB.connected() ? await Discover.topLibraryArtists('all_time', 20).catch(() => []) : [];
  if (!artists.length) {
    const fav = await albums('frequent', 60).catch(() => []);
    const seen = new Set();
    artists = fav.filter((a) => a.artistId && !seen.has(a.artistId) && seen.add(a.artistId)).slice(0, 20).map((a) => ({ id: a.artistId, name: a.artist }));
  }
  if (!live()) return;
  const box = $('#shop-artists');
  box.innerHTML = `<section class="section"><div class="section-head"><h2>Missing From Your Artists</h2></div><p class="section-note" id="shop-progress"></p><div id="shop-groups"></div></section>`;
  let done = 0, total = 0;
  for (const s of artists) {
    if (!live()) return;
    $('#shop-progress').textContent = `Checking ${done + 1} of ${artists.length} artists… (MusicBrainz answers one question a second, so the first time takes a minute or two)`;
    const r = await API.call('getArtist', { id: s.id }, { cache: 5 * MIN }).catch(() => null);
    const d = r ? await Disco.forArtist(r.artist, r.artist.album || []).catch(() => null) : null;
    done++;
    if (!live()) return;
    if (d && d.missing.length) {
      total += d.missing.length;
      $('#shop-groups').insertAdjacentHTML('beforeend', `<div class="shop-artist"><div class="shop-artist-head"><a href="#/artist/${esc(r.artist.id)}">${esc(r.artist.name)}</a>
        <span>you have ${d.owned.length} of ${d.total}</span></div><div class="shelf">${d.missing.map((g) => missingCard({ ...g, artist: r.artist.name, cover: caaGroup(g.id) })).join('')}</div></div>`);
    }
  }
  if (live()) $('#shop-progress').textContent = total ? `${plural(total, 'album')} missing from ${plural(artists.length, 'artist')} you play most.` : 'Nothing missing: you have every studio album and EP from the artists you play most.';
};

Object.assign(actions, {
  'not-interested': (el) => {
    Hidden.add(el.dataset.id);
    $$(`.missing-card[data-rg="${CSS.escape(el.dataset.id)}"]`).forEach((c) => c.remove());
    toast('Hidden. You can bring it back from the Shopping List.');
  },
  'unhide-all': () => { Hidden.clear(); toast('Hidden albums are back'); UI.render(); },
});

// Navigation: New Releases and Shopping List under Library.
{
  const nav = $('.side-nav');
  const after = $('[data-nav="collection"]', nav);
  if (after && !$('[data-nav="shopping"]', nav)) {
    after.insertAdjacentHTML('afterend', `<a href="#/new" data-nav="new"><span class="ico">${icon('sparkle')}</span>New Releases</a>
      <a href="#/shopping" data-nav="shopping"><span class="ico">${icon('bag')}</span>Shopping List</a>`);
  }
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const c = $('.lib-links [href="#/collection"]', main);
    if (c && !$('.lib-links [href="#/shopping"]', main)) c.insertAdjacentHTML('afterend', `<a href="#/new"><span class="ico">${icon('sparkle')}</span>New Releases</a><a href="#/shopping"><span class="ico">${icon('bag')}</span>Shopping List</a>`);
    return p;
  };
}
window.MB = MB;
window.Disco = Disco;
window.Fresh = Fresh;
