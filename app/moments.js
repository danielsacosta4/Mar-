/* Maré — Round 6: Moments. Home adapts to the time of day and week: a "Right Now" row with what you usually play at
   this hour, and a Moments page with every slot. Built from the last few months of ListenBrainz listens. Loaded after
   timemachine.js (uses Listens, matchAlbums, topOf, splitKey from there). */
'use strict';

const Moments = {
  DAYS: 120,          // how far back to look
  MIN: 25,            // plays a slot needs before we say anything about it
  KEY: 'moments',
  PARTS: ['morning', 'afternoon', 'evening', 'night'],
  now: () => new Date(),

  // Slots are "wd" (Mon–Fri) or "we" (Sat–Sun) plus a part of the day.
  slotFor(d) {
    const h = d.getHours();
    const part = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'night';
    return (d.getDay() === 0 || d.getDay() === 6 ? 'we' : 'wd') + '.' + part;
  },
  label(k) {
    const [wk, part] = k.split('.');
    return `${wk === 'we' ? 'Weekend' : 'Weekday'} ${part}s`;
  },
  // "Friday evening" for the current moment.
  nowLabel(d) { return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${this.slotFor(d).split('.')[1]}`; },

  async load() {
    const hit = store.get(this.KEY);
    if (hit && hit.v === 1 && Date.now() - hit.t < 12 * HOUR) return hit;
    if (this._p) return this._p;
    this._p = (async () => {
      const to = Math.floor(Date.now() / 1000) + 1, from = to - this.DAYS * 86400;
      const slots = {};
      await Listens.each(from, to, (page) => {
        for (const l of page) {
          const m = l.track_metadata || {}, artist = m.artist_name || '';
          if (!artist) continue;
          const s = slots[this.slotFor(new Date(l.listened_at * 1000))] ||= { plays: 0, artists: {}, albums: {}, songs: {} };
          s.plays++;
          s.artists[artist] = (s.artists[artist] || 0) + 1;
          if (m.release_name) { const k = artist + '\u0001' + m.release_name; s.albums[k] = (s.albums[k] || 0) + 1; }
          if (m.track_name) { const k = artist + '\u0001' + m.track_name; s.songs[k] = (s.songs[k] || 0) + 1; }
        }
      });
      const top = (o, n) => Object.fromEntries(topOf(o, n));
      for (const s of Object.values(slots)) { s.artists = top(s.artists, 12); s.albums = top(s.albums, 30); s.songs = top(s.songs, 60); }
      const out = { v: 1, t: Date.now(), slots };
      store.set(this.KEY, out);
      return out;
    })().finally(() => { this._p = null; });
    return this._p;
  },

  // "A, B and C"
  names(s, n = 3) {
    const a = topOf(s.artists, n).map(([x]) => x);
    return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  },
  ready(m, k) { return !!m?.slots?.[k] && m.slots[k].plays >= this.MIN; },

  async songs(s) {
    const found = (await Match.many(topOf(s.songs, 60).map(([k]) => { const { artist, name } = splitKey(k); return { artist, title: name }; }))).filter(Boolean);
    const seen = new Set();
    return found.filter((x) => !seen.has(x.id) && seen.add(x.id));
  },
};

/* ================= Home: "Right Now" ================= */
{
  const orig = Discover.home.bind(Discover);
  Discover.home = async (box) => {
    await orig(box);
    if (!LB.connected() || !box?.isConnected) return;
    const route = UI.route;
    const m = await Moments.load().catch(() => null);
    if (!m || UI.route !== route || !box.isConnected) return;
    const now = Moments.now(), k = Moments.slotFor(now);
    if (!Moments.ready(m, k)) return;
    const s = m.slots[k];
    const albums = await matchAlbums(topOf(s.albums, 30), 8);
    if (albums.length < 3 || UI.route !== route || !box.isConnected || $('.moments-now', box)) return;
    box.insertAdjacentHTML('afterbegin', `<section class="section moments-now"><div class="section-head"><h2>Right Now</h2>
        <span class="head-links"><a href="#" data-act="play-moment" data-slot="${k}">Play this moment</a><a href="#/moments">All moments</a></span></div>
      <p class="section-note">${esc(Moments.nowLabel(now))}. Your usual: ${esc(Moments.names(s))}.</p>
      ${shelf(albums.map((x) => x.album))}</section>`);
  };
}

/* ================= Moments page ================= */

View.moments = async (main) => {
  if (!LB.connected()) {
    main.innerHTML = '<h1 class="page-title">Moments</h1><div class="empty"><h3>Connect ListenBrainz</h3><p>Moments learn from when you listen, using your ListenBrainz history.</p><button class="btn btn-primary" data-act="lb-connect">Connect ListenBrainz</button></div>';
    return;
  }
  main.innerHTML = '<h1 class="page-title">Moments</h1><p class="section-note" id="mo-note">Reading your listening habits from ListenBrainz…</p><div id="mo-body"></div>';
  const m = await Moments.load().catch(() => null);
  if (UI.route.name !== 'moments') return;
  const note = $('#mo-note');
  const cur = Moments.slotFor(Moments.now());
  const all = ['wd', 'we'].flatMap((w) => Moments.PARTS.map((p) => `${w}.${p}`));
  const keys = [cur, ...all.filter((k) => k !== cur)];
  const ready = keys.filter((k) => Moments.ready(m, k)), thin = keys.filter((k) => !Moments.ready(m, k));
  if (!ready.length) {
    note.remove();
    $('#mo-body').innerHTML = '<div class="empty"><h3>Not enough listening yet</h3><p>Moments need a few weeks of plays at different times of the day. Keep listening and they will appear.</p></div>';
    return;
  }
  note.textContent = `What you play, and when. Based on your last ${Math.round(Moments.DAYS / 30)} months of listening.`;
  $('#mo-body').innerHTML = ready.map((k) => {
    const s = m.slots[k];
    return `<section class="section moment" data-slot="${k}"><div class="section-head"><h2>${esc(Moments.label(k))}${k === cur ? '<span class="tag-now">Now</span>' : ''}</h2>
        <span class="head-links"><a href="#" data-act="play-moment" data-slot="${k}">Play this moment</a></span></div>
      <p class="section-note">${plural(s.plays, 'play')}. Mostly ${esc(Moments.names(s))}.</p><div class="mo-shelf"></div></section>`;
  }).join('') + (thin.length ? `<p class="section-note mo-thin">Not enough plays yet for: ${esc(thin.map((k) => Moments.label(k).toLowerCase()).join(', '))}.</p>` : '');
  for (const k of ready) {
    const albums = await matchAlbums(topOf(m.slots[k].albums, 30), 8);
    if (UI.route.name !== 'moments') return;
    const box = $(`.moment[data-slot="${k}"] .mo-shelf`, main);
    if (box) box.innerHTML = albums.length ? shelf(albums.map((x) => x.album)) : '<p class="section-note">None of these albums are in your library.</p>';
  }
  markPlaying();
};

Object.assign(actions, {
  'play-moment': async (el) => {
    const m = await Moments.load().catch(() => null), s = m?.slots?.[el.dataset.slot];
    if (!s) return;
    toast('Finding your songs for this moment…');
    const songs = await Moments.songs(s);
    if (songs.length) Player.playList(songs, 0, { shuffle: true });
    else toast('None of these songs are in your library');
  },
});

// Navigation: Moments under Library, next to Your Year.
{
  STROKE.moments = '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>';
  const nav = $('.side-nav');
  const after = $('[data-nav="year"]', nav) || $('[data-nav="shopping"]', nav);
  if (after && !$('[data-nav="moments"]', nav)) after.insertAdjacentHTML('afterend', `<a href="#/moments" data-nav="moments"><span class="ico">${icon('moments')}</span>Moments</a>`);
  const lib = View.library;
  View.library = async (main) => {
    const p = lib(main);
    const y = $('.lib-links [href="#/year"]', main) || $('.lib-links [href="#/shopping"]', main);
    if (y && !$('.lib-links [href="#/moments"]', main)) y.insertAdjacentHTML('afterend', `<a href="#/moments"><span class="ico">${icon('moments')}</span>Moments</a>`);
    return p;
  };
}

window.Moments = Moments;
