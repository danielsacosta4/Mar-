/* Maré — a measuring tool (1.8.4), loaded only when asked for in Settings on a computer: is a "hi-res" file really
   hi-res? It reads the start of the original file, lets the browser decode it at the file's own sample rate, and looks
   at two things a label can't hide:
     - where the sound stops. A CD-quality recording stretched to 96 kHz has a cliff at about 21–24 kHz and nothing
       above it; a real 96 kHz recording fades out gradually (or not at all) towards 48 kHz.
     - whether the extra 8 bits of a 24-bit file are used. A 16-bit recording saved as 24-bit leaves them empty.
   It gives a likelihood, not proof: quiet acoustic music and old tape can be real hi-res with very little up there.
   Uses API, Catalog, esc, toast from the earlier files. */
'use strict';

const HiCheck = {
  N: 16384,            // window length for the spectrum
  WINDOWS: 28,         // how many windows, spread over what was read
  SECONDS: 45,         // how much of each song is read (from its start)

  // In-place radix-2 FFT on re/im (Float64Array, length a power of two).
  fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; const u = im[i]; im[i] = im[j]; im[j] = u; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  },

  // Average level per 500 Hz band, in dB below full scale. Windows that are nearly silent are left out.
  bands(ch, rate) {
    const N = this.N, half = N / 2, power = new Float64Array(half), re = new Float64Array(N), im = new Float64Array(N);
    const usable = ch.length - N;
    if (usable <= 0) return null;
    const hann = new Float64Array(N);
    for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    let used = 0;
    for (let w = 0; w < this.WINDOWS; w++) {
      const start = Math.floor(usable * (0.04 + 0.92 * w / Math.max(1, this.WINDOWS - 1)));
      let peak = 0;
      for (let i = 0; i < N; i++) { const v = ch[start + i]; re[i] = v * hann[i]; im[i] = 0; if (v > peak) peak = v; else if (-v > peak) peak = -v; }
      if (peak < 0.003) continue;   // a pause: its spectrum says nothing about the recording
      this.fft(re, im);
      for (let k = 0; k < half; k++) power[k] += re[k] * re[k] + im[k] * im[k];
      used++;
    }
    if (!used) return null;
    const hz = rate / N, step = 500, count = Math.floor(rate / 2 / step), out = new Float64Array(count), ref = (N / 4) * (N / 4);
    for (let b = 0; b < count; b++) {
      const k0 = Math.max(1, Math.round(b * step / hz)), k1 = Math.min(half, Math.round((b + 1) * step / hz));
      let s = 0;
      for (let k = k0; k < k1; k++) s += power[k];
      out[b] = 10 * Math.log10(s / Math.max(1, k1 - k0) / used / ref + 1e-30);
    }
    return { db: out, step, used };
  },

  // Where does the sound stop? Looks for the steepest fall and checks that what lies above it stays down.
  cliff(bands, rate) {
    const B = bands.db, step = bands.step, nyq = rate / 2;
    const mean = (f0, f1) => { let s = 0, n = 0; for (let b = Math.max(0, Math.floor(f0 / step)); b < Math.min(B.length, Math.ceil(f1 / step)); b++) { s += B[b]; n++; } return n ? s / n : -300; };
    let best = null;
    for (let f = 15000; f <= nyq - 3000; f += step) {
      const below = mean(f - 2500, f - 500), above = mean(f + 500, f + 2500), drop = below - above;
      if (!best || drop > best.drop) best = { f, drop, below };
    }
    if (!best) return { top: nyq };
    const rest = mean(best.f + 1000, nyq - 500);
    // A cliff: at least 30 dB down within a couple of kHz, and it never comes back up.
    if (best.drop >= 30 && best.below - rest >= 30) {
      // The exact edge: the last band still within 12 dB of the level below.
      let edge = best.f;
      for (let f = best.f - 2500; f <= best.f + 2500; f += step) if (mean(f, f + step) > best.below - 12) edge = f + step;
      return { cliff: edge, drop: Math.round(best.drop), top: edge };
    }
    return { top: nyq, drop: Math.round(best.drop) };
  },

  // Are the lower 8 bits of a 24-bit file empty? (Every sample is then a whole number of 16-bit steps.)
  padded(ch) {
    const stepN = Math.max(1, Math.floor(ch.length / 300000));
    let loud = 0, off = 0, n = 0;
    for (let i = 0; i < ch.length; i += stepN) {
      const v = ch[i] * 32768, r = Math.round(v);
      if (r !== 0) loud++;
      if (Math.abs(v - r) > 0.002) off++;
      n++;
    }
    if (loud < 1000) return null;            // too quiet to tell
    return off / n < 0.0005;
  },

  // Only the start of each file is downloaded, which leaves a FLAC cut in the middle of a frame; Firefox refuses
  // such a file outright. So: read the true rate and bit depth from its header, mark the length as unknown, and cut
  // it cleanly at the start of its last frame. Returns null when it isn't a FLAC (then the bytes go in as they are).
  flac(buf) {
    const u = new Uint8Array(buf);
    if (u.length < 42 || u[0] !== 0x66 || u[1] !== 0x4c || u[2] !== 0x61 || u[3] !== 0x43) return null;   // "fLaC"
    let p = 4, info = null;
    for (;;) {
      if (p + 4 > u.length) return null;
      const last = u[p] & 0x80, type = u[p] & 0x7f, len = (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3];
      if (type === 0 && len >= 34) info = p + 4;
      p += 4 + len;
      if (last) break;
    }
    if (info === null || p >= u.length) return null;
    const rate = (u[info + 10] << 12) | (u[info + 11] << 4) | (u[info + 12] >> 4);
    const bits = (((u[info + 12] & 1) << 4) | (u[info + 13] >> 4)) + 1;
    // Frame headers end in a checksum of themselves, which tells a real frame start from a chance 0xFFF8 in the sound.
    const crc8 = (from, to) => { let c = 0; for (let i = from; i < to; i++) { c ^= u[i]; for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; };
    const frameAt = (i) => {
      if (u[i] !== 0xff || (u[i + 1] & 0xfe) !== 0xf8 || i + 16 > u.length) return false;
      const bs = u[i + 2] >> 4, sr = u[i + 2] & 0x0f;
      if (bs === 0 || sr === 0x0f || (u[i + 3] & 1)) return false;
      let q = i + 4;
      const lead = u[q]; let extra = 0;
      if (lead & 0x80) { for (let m = 0x40; lead & m; m >>= 1) extra++; if (extra < 1 || extra > 6) return false; }
      q += 1 + extra;
      if (bs === 6) q += 1; else if (bs === 7) q += 2;
      if (sr === 12) q += 1; else if (sr === 13 || sr === 14) q += 2;
      return q < u.length && crc8(i, q) === u[q];
    };
    let cut = -1;
    for (let i = u.length - 17; i > p; i--) if (frameAt(i)) { cut = i; break; }
    if (cut < 0) return null;
    const out = u.slice(0, cut);
    out[info + 13] &= 0xf0; out[info + 14] = out[info + 15] = out[info + 16] = out[info + 17] = 0;   // total samples: unknown
    for (let i = 18; i < 34; i++) out[info + i] = 0;                                                    // checksum of the whole: none
    return { buf: out.buffer, rate, bits, audioBytes: cut - p };
  },

  // Decode at the file's own rate: only then is anything above 22 kHz still there to look at.
  async decode(buf, rate) {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let ctx;
    try { ctx = new Ctx(1, 1, rate); } catch (e) { return { error: `this browser can't work at ${rate / 1000} kHz` }; }
    try {
      const audio = await new Promise((res, rej) => { const p = ctx.decodeAudioData(buf, res, rej); if (p && p.catch) p.catch(rej); });
      if (Math.abs(audio.sampleRate - rate) > 1) return { error: `this browser read it at ${audio.sampleRate / 1000} kHz instead of ${rate / 1000} kHz` };
      return { audio };
    } catch (e) { return { error: 'this browser couldn\'t read the file' }; }
  },

  // The whole judgement for one file. `meta`: { rate, bits } as its tags say.
  async analyse(buf, meta) {
    const f = this.flac(buf);
    const want = { rate: (f && f.rate) || meta.rate, bits: (f && f.bits) || meta.bits || 0 };
    if (!want.rate) return { error: 'the file doesn\'t say its sample rate' };
    const d = await this.decode(f ? f.buf : buf, want.rate);
    if (d.error) return { error: d.error };
    const ch = d.audio.getChannelData(0), rate = d.audio.sampleRate;
    const out = { rate, bits: want.bits, seconds: Math.round(ch.length / rate) };
    if (out.seconds < 6) return { error: 'too little of the song could be read' };
    const bands = this.bands(ch, rate);
    if (!bands) return { error: 'the part that was read is silent' };
    Object.assign(out, this.cliff(bands, rate));
    if (out.bits > 16 && this.keeps24 !== false) { const p = this.padded(ch); if (p !== null) out.padded = p; }
    // What a cliff means. At the top of CD / 48 kHz sound (about 20–27 kHz, depending on how carefully it was
    // stretched) inside a faster file: an upsampled recording. At the top of 88.2 / 96 kHz sound inside a
    // 176.4 / 192 kHz file: the same, one step up. Anywhere else, the sound was simply cut off there.
    const c = out.cliff, nyq = rate / 2;
    out.from = !c ? '' : c >= 19000 && c <= 27000 && nyq > 30000 ? 'cd' : c >= 40000 && c <= 56000 && nyq > 60000 ? 'double' : '';
    out.verdict = out.from ? 'upsampled' : c && nyq > 30000 && c < nyq - 6000 ? 'cut' : out.padded ? 'padded' : rate > 48000 || out.bits > 16 ? 'native' : 'cd';
    return out;
  },

  // Can this browser do it at all? A tiny 24-bit / 96 kHz file with a 30 kHz tone, shipped with the app.
  keeps24: null, reads96: null,
  async probe() {
    if (this.reads96 !== null) return;
    try {
      const buf = await (await fetch(`probe-24-96.flac?v=${window.MARE_VERSION}`)).arrayBuffer();
      const d = await this.decode(buf, 96000);
      if (d.error) { this.reads96 = false; this.keeps24 = false; return; }
      const ch = d.audio.getChannelData(0), b = this.bands(ch, 96000);
      this.reads96 = !!b && b.db[60] > b.db[40] + 30;   // the tone at 30 kHz stands out
      this.keeps24 = this.padded(ch) === false;
    } catch (e) { this.reads96 = false; this.keeps24 = false; }
  },

  /* ---------- the tool: Settings → Library → "Check a sample of hi-res albums" ---------- */

  // Albums whose files say "hi-res": 24-bit, or faster than 48 kHz, and not lossy.
  pick(d, n) {
    return shuffleArr(Object.entries(d.albums).filter(([, a]) => a[11] && a[13] < a[11] && (a[5] > 16 || a[7] > 48000))).slice(0, n);
  },
  // One song of the album, from its middle (openings are often quiet).
  async song(albumId) {
    const r = await API.call('getAlbum', { id: albumId });
    const songs = (r.album?.song || []).filter((s) => s.bitDepth > 16 || s.samplingRate > 48000);
    return songs[Math.floor(songs.length / 2)] || null;
  },
  // The start of the original file: enough for about 45 seconds of sound, whatever art is packed in front of it.
  async read(song) {
    const want = Math.round(Math.min(60e6, Math.max(8e6, (song.bitRate || 3000) * 125 * this.SECONDS + 6e6)));
    const ctl = new AbortController();
    const res = await fetch(API.stream(song.id, { format: 'raw' }), { headers: { Range: `bytes=0-${want - 1}` }, signal: ctl.signal });
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    if (res.status === 200 && +res.headers.get('Content-Length') > 200e6) { ctl.abort(); throw new Error('the server would only send the whole file, and it is very large'); }
    const buf = await res.arrayBuffer();
    return buf.byteLength > want ? buf.slice(0, want) : buf;
  },

  top(hz) { return `${+(hz / 1000).toFixed(1)} kHz`; },
  // [short word, css class, one plain sentence]
  words(r) {
    if (r.error) return ['Not checked', 'none', `It couldn't be checked: ${r.error}.`];
    const pad = r.padded ? ' Its extra 8 bits are empty as well (16-bit sound).' : '';
    if (r.verdict === 'upsampled') return ['Upsampled', 'bad', `The sound ends at ${this.top(r.cliff)}: ${r.from === 'cd' ? 'a CD-rate recording' : 'an 88–96 kHz recording'} inside a ${this.top(r.rate)} file.${pad}`];
    if (r.verdict === 'cut') return ['Cut off', 'bad', `The sound ends at ${this.top(r.cliff)}, well below the ${this.top(r.rate / 2)} this file could hold.${pad}`];
    if (r.verdict === 'padded') return ['Padded', 'bad', '16-bit sound in a 24-bit file: the extra 8 bits are empty.'];
    if (r.verdict === 'native') return ['Native', 'good', r.rate > 48000 ? `No cut-off: the sound runs to the top (${this.top(r.rate / 2)}).` : 'It uses all of its 24 bits.'];
    return ['CD quality', 'none', 'A 16-bit file at CD rate.'];
  },

  busy: false, rows: [],
  async run(box) {
    if (this.busy) return;
    this.busy = true;
    const show = (html) => { box.hidden = false; box.innerHTML = html; };
    try {
      show('<p class="hc-note">Getting ready…</p>');
      await this.probe();
      if (!this.reads96) { show('<p class="hc-note">This browser can\'t read hi-res files at their own speed, so it has nothing to measure. Firefox and Chrome on a computer can.</p>'); return; }
      const d = Catalog.load();
      if (!d) { show('<p class="hc-note">Maré is still reading your collection. Open Collection, let it finish, then come back.</p>'); return; }
      const picks = this.pick(d, 20);
      if (!picks.length) { show('<p class="hc-note">No album in your library is labelled hi-res.</p>'); return; }
      this.rows = [];
      for (let i = 0; i < picks.length; i++) {
        const [id, a] = picks[i];
        this.draw(box, `Reading ${i + 1} of ${picks.length}: ${a[0]}…`);
        let r, song = null;
        try {
          song = await this.song(id);
          if (!song) throw new Error('no hi-res song was found in it');
          r = await this.analyse(await this.read(song), { rate: song.samplingRate, bits: song.bitDepth });
        } catch (e) { r = { error: e.message || 'it couldn\'t be read' }; }
        if (r.error) r.error = String(r.error).replace(/\.$/, '');
        this.rows.push({ id, album: a[0], artist: a[1], song: song ? song.title : '', says: song && song.bitDepth && song.samplingRate ? `${song.bitDepth}/${khz(song.samplingRate)}` : '', r });
        if (!box.isConnected) return;   // the listener left Settings: stop quietly
      }
      this.draw(box, '');
    } catch (e) { show(`<p class="hc-note">The check stopped: ${esc(e.message || 'unknown reason')}.</p>`); } finally { this.busy = false; }
  },

  counts() {
    const c = { native: 0, upsampled: 0, padded: 0, cut: 0, none: 0 };
    this.rows.forEach(({ r }) => { if (r.error || !c.hasOwnProperty(r.verdict)) c.none++; else c[r.verdict]++; });
    return c;
  },
  summary() {
    const c = this.counts(), bits = [`${c.native} native`];
    if (c.upsampled) bits.push(`${c.upsampled} upsampled`);
    if (c.cut) bits.push(`${c.cut} cut off`);
    if (c.padded) bits.push(`${c.padded} padded`);
    if (c.none) bits.push(`${c.none} not checked`);
    return `Of ${this.rows.length} albums: ${bits.join(', ')}.`;
  },
  draw(box, doing) {
    const rows = this.rows.map(({ id, album, artist, song, says, r }) => {
      const [word, cls, text] = this.words(r);
      return `<div class="hc-row"><a class="hc-name" href="#/album/${esc(id)}"><b>${esc(album)}</b><span>${esc(artist)}${song ? ` · “${esc(song)}”` : ''}</span></a>
        <span class="hc-says">${esc(says)}</span><span class="hc-v ${cls}">${esc(word)}</span><p>${esc(text)}</p></div>`;
    }).join('');
    box.hidden = false;
    box.innerHTML = `<p class="hc-note">${doing ? esc(doing) : `<b>${esc(this.summary())}</b> One song per album, its first 45 seconds. A likelihood, not proof: quiet acoustic music and old tape can be real hi-res with little up high.`}</p>
      ${rows}${doing || !this.rows.length ? '' : '<div class="hc-foot"><button class="btn" data-hc-copy>Copy result</button><button class="btn btn-link" data-act="hi-check">Check another 20</button></div>'}`;
    const copy = box.querySelector('[data-hc-copy]');
    if (copy) copy.onclick = async () => {
      const text = this.text();
      try { await navigator.clipboard.writeText(text); toast('Result copied. Paste it in your message.'); }
      catch (e) { box.insertAdjacentHTML('beforeend', `<textarea class="diag-text" readonly>${esc(text)}</textarea>`); box.querySelector('.diag-text').select(); toast('Select all and copy the text below'); }
    };
  },
  text() {
    return [`Maré ${window.MARE_VERSION} · hi-res sample · ${new Date().toISOString().slice(0, 10)}`, this.summary(),
      ...this.rows.map(({ album, artist, song, says, r }) => {
        const [word] = this.words(r);
        const what = r.error ? r.error : `${r.bits}/${+(r.rate / 1000).toFixed(1)}${r.cliff ? `, ends at ${this.top(r.cliff)} (fall ${r.drop} dB)` : ', no cut-off'}${r.padded === true ? ', low bits empty' : r.padded === false ? ', low bits used' : ''}, ${r.seconds} s read`;
        return `${word} | ${album} — ${artist} | tags ${says || '?'} | ${what} | ${song}`;
      })].join('\n');
  },
};
window.HiCheck = HiCheck;
