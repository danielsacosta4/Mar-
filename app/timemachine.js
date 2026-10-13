/* Maré — Round 5b: the time machine. "On this day" on Home and a Year in review for any year, built from your
   ListenBrainz listening history. Loaded after shopping.js. */
'use strict';

/* ================= Listening history ================= */
// ListenBrainz hands out listens 1,000 at a time, newest first. A finished year is read once and kept as a compact
// summary (top artists/albums/songs, months, weekdays…); the current year is re-read after a few hours.

const Listens = {
  key: (y) => 'hist.' + y,
  progress: null,
  async page(maxTs) {
    const user = encodeURIComponent(LB.cfg().user);
    for (let attempt = 0; ; attempt++) {
      try { return (await LB.get(`user/${user}/listens`, { max_ts: maxTs, count: 1000 }))?.payload?.listens || []; }
      catch (e) { if (e.code === 429 && attempt < 4) { await sleep(10000); continue; } throw e; }
    }
  },
  // All listens between two timestamps, oldest boundary included; onPage(listens) for each page.
  async each(fromTs, toTs, onPage) {
    let max = toTs;
    for (;;) {
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
    const user = LB.cfg().user;
    if (!user) return [];
    const r = await LB.get(`stats/user/${encodeURIComponent(user)}/listening-activity`, { range: 'all_time' }, { cache: 12 * HOUR }).catch(() => null);
    const ys = (r?.payload?.listening_activity || []).filter((x) => x.listen_count > 0).map((x) => +String(x.time_range).slice(0, 4)).filter(Boolean);
    const now = new Date().getFullYear();
    return [...new Set(ys.length ? ys : [now, now - 1])].sort((a, b) => b - a);
  },

  async year(y, onProgress) {
    const now = new Date();
    const current = y === now.getFullYear();
    const hit = store.get(this.key(y));
    if (hit && hit.v === 1 && (!current || Date.now() - hit.t < 6 * HOUR)) return hit;
    const from = new Date(y, 0, 1).getTime() / 1000, to = Math.min(new Date(y + 1, 0, 1).getTime() / 1000, Math.floor(Date.now() / 1000) + 1);
    const s = { v: 1, t: Date.now(), year: y, current, plays: 0, durN: 0, durMs: 0, artists: {}, albums: {}, songs: {}, months: Array(12).fill(0), days: Array(7).fill(0), byDay: {} };
    await this.each(from, to, (page) => {
      for (const l of page) {
        const m = l.track_metadata || {}, info = m.additional_info || {};
        const artist = m.artist_name || '', d = new Date(l.listened_at * 1000);
        s.plays++;
        const ms = info.duration_ms || (info.duration ? info.duration * 1000 : 0);
        if (ms) { s.durN++; s.durMs += ms; }
        if (artist) s.artists[artist] = (s.artists[artist] || 0) + 1;
        if (m.release_name) { const k = artist + '\u0001' + m.release_name; s.albums[k] = (s.albums[k] || 0) + 1; }
        if (m.track_name) { const k = artist + '\u0001' + m.track_name; s.songs[k] = (s.songs[k] || 0) + 1; }
        s.months[d.getMonth()]++;
        s.days[d.getDay()]++;
        const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        s.byDay[day] = (s.byDay[day] || 0) + 1;
      }
      onProgress?.(s.plays);
    });
    // Keep it small: every artist (needed for "new artists"), the top albums and songs, the busiest day.
    const top = (o, n) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n));
    s.albums = top(s.albums, 60); s.songs = top(s.songs, 100);
    s.busiestDay = Object.entries(s.byDay).sort((a, b) => b[1] - a[1])[0] || null;
    delete s.byDay;
    store.set(this.key(y), s);
    return s;
  },

  // Listens on one calendar day (local time).
  async day(date) {
    const from = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 1000;
    const to = from + 86400;
    const key = 'hist.day.' + new Date(from * 1000).toISOString().slice(0, 10);
    const hit = store.get(key);
    if (hit && Date.now() - hit.t < 7 * DAY) return hit.v;
    const out = [];
    await this.each(from, to, (page) => out.push(...page.map((l) => ({ a: l.track_metadata?.artist_name || '', t: l.track_metadata?.track_name || '', r: l.track_metadata?.release_name || '' }))));
    store.set(key, { t: Date.now(), v: out });
    return out;
  },
};

const splitKey = (k) => { const [artist, name] = k.split('\u0001'); return { artist, name }; };
const topOf = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }));
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2000, 0, 2 + i).toLocaleDateString(undefined, { weekday: 'short' }));   // 2 Jan 2000 was a Sunday

// Albums (library matches) for a list of [artist·release, plays].
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

/* ================= On this day (Home) ================= */

const OnThisDay = {
  // The most recent past year (up to 5 back) with listens on today's date.
  async find() {
    const today = new Date();
    const years = await Listens.years();
    for (let back = 1; back <= 5; back++) {
      const y = today.getFullYear() - back;
      if (years.length && !years.includes(y)) continue;
      const date = new Date(y, today.getMonth(), today.getDate());
      const listens = await Listens.day(date).catch(() => []);
      if (listens.length) return { date, listens };
    }
    return null;
  },
};

{
  const orig = Discover.home.bind(Discover);
  Discover.home = async (box) => {
    await orig(box);
    if (!LB.connected() || !box?.isConnected) return;
    const route = UI.route;
    const hit = await OnThisDay.find().catch(() => null);
    if (!hit || UI.route !== route || !box.isConnected) return;
    const counts = {};
    hit.listens.forEach((l) => { if (l.r) { const k = l.a + '\u0001' + l.r; counts[k] = (counts[k] || 0) + 1; } });
    const albumsThatDay = await matchAlbums(topOf(counts, 12), 8);
    if (UI.route !== route || !box.isConnected) return;
    const when = hit.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    const years = new Date().getFullYear() - hit.date.getFullYear();
    box.insertAdjacentHTML('afterbegin', `<section class="section on-this-day"><div class="section-head"><h2>On This Day</h2>
        <span class="head-links"><a href="#" data-act="play-day" data-day="${hit.date.getTime()}">Play that day</a><a href="#/year/${hit.date.getFullYear()}">Your ${hit.date.getFullYear()}</a></span></div>
      <p class="section-note">${years === 1 ? 'A year ago' : `${years} years ago`}, on ${esc(when)}, you played ${plural(hit.listens.length, 'song')}${albumsThatDay.length ? '. These were the albums:' : '.'}</p>
      ${albumsThatDay.length ? shelf(albumsThatDay.map((x) => x.album)) : ''}</section>`);
  };
}

/* ================= Year in review ================= */

View.year = async (main, params, yArg) => {
  if (!LB.connected()) {
    main.innerHTML = '<h1 class="page-title">Your Year</h1><div class="empty"><h3>Connect ListenBrainz</h3><p>Your year in music is built from your ListenBrainz listening history.</p><button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div>';
    return;
  }
  const years = await Listens.years();
  const now = new Date().getFullYear();
  const y = +yArg || years.find((x) => x < now) || years[0] || now;
  const live = () => UI.route.name === 'year' && (+UI.route.id || y) === y;
  const chips = `<div class="chips year-chips">${years.map((x) => `<a class="chip${x === y ? ' on' : ''}" href="#/year/${x}">${x}</a>`).join('')}</div>`;
  main.innerHTML = `<header class="masthead"><h1 class="mast-title cond">${y}</h1><div class="mast-issue"><span class="label">Your year in music</span><span class="when" id="year-when">${y === now ? 'So far this year' : ''}</span></div></header>
    ${chips}<p class="section-note" id="year-progress">Reading your ${y} listening history from ListenBrainz…</p><div id="year-body"></div>`;

  // "New artists" needs the years before it, so read those too (once; finished years are kept).
  const earlier = years.filter((x) => x < y).sort((a, b) => a - b);
  const progress = (n) => { const el = $('#year-progress'); if (el) el.textContent = `Reading your ${y} listening history from ListenBrainz… ${n.toLocaleString()} plays so far`; };
  const s = await Listens.year(y, progress);
  const seenBefore = new Set();
  for (const e of earlier) {
    if (!live()) return;
    const p = $('#year-progress');
    if (p && !store.get(Listens.key(e))) p.textContent = `Reading ${e} too, to find the artists you discovered in ${y}…`;
    const es = await Listens.year(e).catch(() => null);
    if (es) Object.keys(es.artists).forEach((a) => seenBefore.add(norm(a)));
  }
  if (!live()) return;
  if (!s.plays) { $('#year-progress').remove(); $('#year-body').innerHTML = `<div class="empty"><h3>No listens in ${y}</h3><p>ListenBrainz has nothing for this year.</p></div>`; return; }

  const artistsTop = topOf(s.artists, 10);
  const newArtists = earlier.length ? topOf(s.artists, 9999).filter(([a]) => !seenBefore.has(norm(a))) : [];
  const hours = s.durN >= s.plays * 0.5 ? Math.round((s.durMs / s.durN) * s.plays / 3600000) : null;
  const busiestMonth = s.months.indexOf(Math.max(...s.months));
  const busiestDay = s.days.indexOf(Math.max(...s.days));
  $('#year-when').textContent = `${y === now ? 'So far: ' : ''}${s.plays.toLocaleString()} plays${hours != null ? ` · about ${hours.toLocaleString()} hours` : ''}`;
  $('#year-progress').textContent = 'Matching your favourites to your library…';

  const [albumsTop, songsTop] = await Promise.all([
    matchAlbums(topOf(s.albums, 40), 12),
    Match.many(topOf(s.songs, 40).map(([k]) => { const { artist, name } = splitKey(k); return { artist, title: name }; })).then((l) => l.filter(Boolean)).catch(() => []),
  ]);
  if (!live()) return;
  $('#year-progress').remove();
  const seen = new Set();
  const songs = songsTop.filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, 20);
  const hero = albumsTop[0];
  const cell = (n, l) => `<div><b>${esc(n)}</b>${esc(l)}</div>`;
  const bars = (vals, labels, hi) => { const max = Math.max(1, ...vals); return `<div class="vbars">${vals.map((v, i) =>
    `<div class="vbar${i === hi ? ' hi' : ''}" title="${esc(labels[i])}: ${v.toLocaleString()} plays"><span class="vbar-n">${v ? v.toLocaleString() : ''}</span><i style="height:${(v / max) * 100}%"></i><span class="vbar-l">${esc(labels[i])}</span></div>`).join('')}</div>`; };
  const artistRows = await Promise.all(artistsTop.map(async ([name, n], i) => {
    const a = await Match.artist(name).catch(() => null);
    return `<${a ? `a href="#/artist/${esc(a.id)}"` : 'div'} class="chart-row"><span class="chart-no">${i + 1}</span>
      ${a?.coverArt ? `<img loading="lazy" src="${esc(API.cover(a.coverArt, 120))}" alt="">` : '<span class="ph"></span>'}
      <span><span class="chart-title">${esc(name)}</span><span class="chart-sub">${plural(n, 'play')}</span></span></${a ? 'a' : 'div'}>`;
  }));
  if (!live()) return;
  const songsList = songs.length ? newList(songs) : null;
  $('#year-body').innerHTML = `
    <section class="front">
      <div class="feature">
        ${hero ? `<a class="art" href="#/album/${esc(hero.album.id)}">${artImg(hero.album.coverArt, 600, hero.album.name)}</a>` : '<div></div>'}
        <div class="feature-text">
          <span class="label">${hero ? `Your album of ${y}` : 'Your year'}</span>
          ${hero ? `<h2 class="feature-title cond"><a href="#/album/${esc(hero.album.id)}">${esc(hero.album.name)}</a></h2>
          <span class="feature-by">${esc(hero.album.artist || '')}</span>
          <p class="feature-quote">You played it ${plural(hero.plays, 'time')}${y === now ? ' so far this year' : ` in ${y}`}.</p>
          <button class="btn btn-primary" data-act="play-album" data-id="${esc(hero.album.id)}">${icon('play')}Play the album</button>` : ''}
        </div>
        <div class="feature-strip">${[
          cell(s.plays.toLocaleString(), 'plays'),
          hours != null ? cell(hours.toLocaleString(), 'hours, about') : cell(Object.keys(s.albums).length >= 60 ? '60+' : String(Object.keys(s.albums).length), 'albums'),
          cell(Object.keys(s.artists).length.toLocaleString(), 'artists'),
          earlier.length ? cell(newArtists.length.toLocaleString(), 'new to you') : cell(MONTHS[busiestMonth], 'busiest month'),
        ].join('')}</div>
      </div>
      <div class="chart"><span class="label">Your top artists</span>${artistRows.slice(0, 5).join('')}</div>
    </section>
    ${songs.length ? `<section class="section"><div class="section-head"><h2>Your Top Songs</h2><a href="#" data-act="play-list" data-list="${songsList}">Play your ${y}</a></div>${trackRows(songs.slice(0, 10), { art: true, numbers: 'index' })}</section>` : ''}
    ${albumsTop.length ? section('Your Top Albums', `<div class="grid">${albumsTop.map((x) => albumCard(x.album).replace('<div class="card-title">', `<div class="card-when">${plural(x.plays, 'play')}</div><div class="card-title">`)).join('')}</div>`) : ''}
    ${artistRows.length > 5 ? section('More Top Artists', `<div class="chart chart-wide">${artistRows.slice(5).join('')}</div>`) : ''}
    ${section('Month by Month', `<p class="section-note">Your busiest month was ${esc(new Date(2000, busiestMonth, 1).toLocaleDateString(undefined, { month: 'long' }))}${s.busiestDay ? `, and your busiest day ${esc(new Date(s.busiestDay[0] + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long' }))} (${plural(s.busiestDay[1], 'play')})` : ''}.</p>${bars(s.months, MONTHS, busiestMonth)}`)}
    ${section('Day by Day', `<p class="section-note">You listen most on ${esc(new Date(2000, 0, 2 + busiestDay).toLocaleDateString(undefined, { weekday: 'long' }))}s.</p>${bars(s.days, WEEKDAYS, busiestDay)}`)}
    ${newArtists.length ? section('New to You', `<p class="section-note">${plural(newArtists.length, 'artist')} you first listened to in ${y}. The ones you played most:</p>
      <div class="chips">${newArtists.slice(0, 24).map(([a, n]) => `<span class="chip">${esc(a)} · ${n}</span>`).join('')}</div>`) : ''}`;
  applyTint($('.feature', main), hero ? API.cover(hero.album.coverArt, 300) : '');
  markPlaying();
};

Object.assign(actions, {
  'play-day': async (el) => {
    const listens = await Listens.day(new Date(+el.dataset.day));
    const uniq = [], seen = new Set();
    for (const l of listens) { const k = norm(l.a) + '|' + norm(l.t); if (l.t && !seen.has(k)) { seen.add(k); uniq.push({ artist: l.a, title: l.t }); } }
    toast('Finding that day\'s songs in your library…');
    const songs = (await Match.many(uniq.slice(0, 60))).filter(Boolean);
    if (songs.length) Player.playList(songs, 0, { shuffle: false });
    else toast('None of that day\'s songs are in your library');
  },
});

// Navigation: Your Year under Library.
{
  STROKE.calendar = '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4"/>';
  const nav = $('.side-nav');
  const after = $('[data-nav="shopping"]', nav);
  if (after && !$('[data-nav="year"]', nav)) after.insertAdjacentHTML('afterend', `<a href="#/year" data-nav="year"><span class="ico">${icon('calendar')}</span>Your Year</a>`);
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const s = $('.lib-links [href="#/shopping"]', main);
    if (s && !$('.lib-links [href="#/year"]', main)) s.insertAdjacentHTML('afterend', `<a href="#/year"><span class="ico">${icon('calendar')}</span>Your Year</a>`);
    return p;
  };
}

window.Listens = Listens;
