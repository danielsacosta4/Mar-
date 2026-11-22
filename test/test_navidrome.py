# Maré against a REAL Navidrome (MARE_NAVIDROME, default http://127.0.0.1:4533, user admin / secret, a few FLAC albums).
# Plays an album with converted quality and walks through the songs, the way the owner found the 1.6.0 bug:
# songs Navidrome has not converted before must start and play. Run with MARE_BROWSER=chromium|firefox|webkit.
# Start Navidrome with an empty transcoding cache before each run (a converted song is only "new" once).
import asyncio, sys, os, json, hashlib
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
ND=os.environ.get('MARE_NAVIDROME','http://127.0.0.1:4533'); QUALITY=os.environ.get('MARE_QUALITY','opus128')
IPHONE=os.environ.get('MARE_IPHONE')=='1'   # iPhone rules: phone screen, touch, no volume control (so Maré uses one player)
def nd(method, extra=''):
    salt='t3st'; t=hashlib.md5(('secret'+salt).encode()).hexdigest()
    return json.load(urlopen(f'{ND}/rest/{method}?u=admin&t={t}&s={salt}&v=1.16.1&c=test&f=json{extra}'))['subsonic-response']
# Phone playback (1.7.0), iPhone rules: songs are saved on the device and played from there. Streaming quality stays
# Original, like the owner's phone. The proof: the server is switched off mid-album and the music carries on.
async def phone_playback(pg, albums):
    import subprocess
    here=os.path.dirname(os.path.abspath(__file__)); bad=[]
    def check(name, ok, detail='', timing=False):
        # Timings only count in Safari's and Chrome's engines: Firefox never runs under iPhone rules for real, and its
        # sound start-up in the sandbox adds about 2 s to every song.
        if timing and NAME=='firefox' and not ok: print(f"  (slow in Firefox's sandbox, not counted) {name} | {detail}"); return
        print(f"  {'ok     ' if ok else 'PROBLEM'} {name}{' | '+str(detail) if detail!='' else ''}")
        if not ok: bad.append(name)
    await pg.evaluate("Prefs.set('quality','original')")
    await pg.reload(); await pg.wait_for_selector('.shelf .card', timeout=20000)
    if await pg.locator('.sheet [data-close]').count(): await pg.click('.sheet [data-close]')
    check('service worker in control, phone playback on', await pg.evaluate("!!navigator.serviceWorker.controller && Ahead.phone()"))
    await pg.goto(B+'#/album/'+albums[0]['id']); await pg.wait_for_selector('.track'); await pg.wait_for_timeout(500)
    if await pg.locator('.sheet [data-close]').count(): await pg.click('.sheet [data-close]')
    await pg.evaluate("""window.__toasts=[]; const tt=window.toast; window.toast=(m)=>{__toasts.push(m); return tt(m)};
      window.__g={ended:0,gaps:[]}; const a=Player.audio;
      a.addEventListener('ended',()=>{__g.ended=performance.now()});
      a.addEventListener('timeupdate',()=>{ if(__g.ended && a.currentTime>0.15 && a.currentTime<3){ __g.gaps.push(Math.round(performance.now()-__g.ended)); __g.ended=0; } });
      window.__t0=performance.now()""")
    await pg.click('.track >> nth=0')
    await pg.wait_for_function("Player.pos()>0.5", timeout=15000)
    start=await pg.evaluate("Math.round(performance.now()-__t0)")
    check('song 1 is a live stream', not await pg.evaluate("!!Player.audio._local"), await pg.evaluate("Player.diag()"))
    check('song 1 starts within 2.5 s', start<2500, f'{start} ms', timing=True)
    try: await pg.wait_for_function("Player.queue.slice(0,4).every(s=>Ahead.has(s.id))", timeout=60000)
    except Exception: pass
    sizes=await pg.evaluate("(async()=>{const c=await caches.open('mare-ahead'); const out=[]; for(const s of Player.queue.slice(0,4)){const r=await c.match('/ahead/'+s.id); out.push(r?Math.round((await r.blob()).size/1024):0)} return out})()")
    check('copies of songs 1-4 saved', all(sizes), f'{sizes} KB at {await pg.evaluate("Ahead.tag()")}')
    await pg.evaluate("Player.seek(20)"); await pg.wait_for_timeout(2500)
    p1=await pg.evaluate("[Math.round(Player.pos()), !!Player.audio._local, Player.audio.paused]")
    check('seek in song 1 moves to its saved copy', 20<=p1[0]<=24 and p1[1] and not p1[2], p1)
    async def run_out(n):   # let the playing song end by itself and the next one begin
        await pg.evaluate("Player.seek(Player.dur()-4)"); i0=await pg.evaluate("Player.index")
        try: await pg.wait_for_function(f"Player.index==={i0+1} && Player.pos()>2", timeout=20000)
        except Exception: pass
        st=await pg.evaluate("({i:Player.index, pos:Math.round(Player.pos()), local:!!Player.audio._local, paused:Player.audio.paused, gap:__g.gaps[__g.gaps.length-1], what:Player.diag()})")
        check(f'song {n} ends -> song {n+1} plays from its copy', st['i']==i0+1 and st['pos']>=2 and st['local'] and not st['paused'], f"gap {st['gap']} ms, {st['what']}")
        return st
    st=await run_out(1)
    check('handover gap under 1 s', (st['gap'] or 9999)<1000, f"{st['gap']} ms", timing=True)
    await pg.wait_for_timeout(1500)
    subprocess.run([os.path.join(here,'real_navidrome.sh'),'stop']); await pg.wait_for_timeout(1000)
    print('  -- Navidrome switched OFF --')
    await pg.wait_for_timeout(5000)
    mid=await pg.evaluate("[Player.index, Math.round(Player.pos()), Player.audio.paused]")
    check('song 2 keeps playing with the server off', mid[0]==1 and not mid[2] and mid[1]>=5, mid)
    await run_out(2); await run_out(3)
    subprocess.run([os.path.join(here,'real_navidrome.sh'),'start'], stdout=subprocess.DEVNULL)
    print('  -- Navidrome back ON --')
    try: await pg.wait_for_function("!Offline.offline", timeout=40000)
    except Exception: pass
    check('Maré notices the server is back', not await pg.evaluate("!!Offline.offline"))
    await run_out(4)
    try: await pg.wait_for_function("Player.queue[5] && Ahead.has(Player.queue[5].id)", timeout=40000)
    except Exception: pass
    check('saving resumes (song 6, never saved before)', await pg.evaluate("!!Player.queue[5] && Ahead.has(Player.queue[5].id)"))
    print('  gaps between songs (ms):', await pg.evaluate("__g.gaps"), '| messages:', (await pg.evaluate("__toasts"))[:3])
    print('  log:', [x[:64] for x in await pg.evaluate("(store.get('playlog')||[]).map(x=>x.why).reverse()")][:12])
    return bad

async def main():
    try: albums=nd('getAlbumList2','&type=alphabeticalByName&size=10')['albumList2']['album']
    except Exception as e: print('SKIPPED: no Navidrome at', ND, f'({e})'); return
    bad=[]
    async with async_playwright() as p:
        br=await launch(p, args=['--autoplay-policy=no-user-gesture-required'])
        ctx=await br.new_context(**(phone(p) if IPHONE else dict(viewport={'width':1300,'height':850})))
        if IPHONE: await ctx.add_init_script("Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});")
        pg=await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await pg.goto(B)
        await pg.evaluate("""async ([nd,q])=>{ await API.login(nd,'admin','secret'); Prefs.set('quality',q); localStorage.removeItem('mare.playlog'); }""",[ND,QUALITY])
        await pg.reload(); await pg.wait_for_selector('.shelf .card', timeout=20000)
        if await pg.locator('.sheet [data-close]').count(): await pg.click('.sheet [data-close]')     # first-visit sheet
        if IPHONE:
            bad=await phone_playback(pg, albums)
            if errs: print('  page errors:', errs[:2])
            await br.close()
            print(f'RESULT [{NAME}, iPhone rules, phone playback]:', 'OK' if not bad else 'PROBLEMS: '+', '.join(bad)); return
        al=albums[0]
        await pg.goto(B+'#/album/'+al['id']); await pg.wait_for_selector('.track'); await pg.wait_for_timeout(500)
        if await pg.locator('.sheet [data-close]').count(): await pg.click('.sheet [data-close]')
        await pg.click('.track >> nth=0')
        await pg.evaluate("""window.__ev=[]; window.__toasts=[]; const tt=window.toast; window.toast=(m)=>{__toasts.push(m); return tt(m)};
          Player.els.forEach(el=>['error','stalled'].forEach(ev=>el.addEventListener(ev,()=>__ev.push(ev+(ev==='error'?' '+(el.error&&el.error.code):'')+'@'+Math.round(Player.pos())))))""")
        rows=[]
        for n in range(4):
            await pg.wait_for_timeout(7000)
            st=await pg.evaluate("({i:Player.index, title:Player.current().title, pos:Math.round(Player.pos()), paused:Player.audio.paused, what:Player.diag()})")
            rows.append(st); ok=st['i']==n and st['pos']>=4 and not st['paused']
            print(f"  song {n+1}: {'plays' if ok else 'PROBLEM'} | {st['title']} at {st['pos']} s | {st['what']}")
            if not ok: bad.append(f'song {n+1}')
            # seek inside the song, then go to the next one
            if ok and n==0:
                await pg.evaluate("Player.seek(30)"); await pg.wait_for_timeout(4000)
                p2=await pg.evaluate("Math.round(Player.pos())"); print(f"  seek to 30 s -> {p2} s"); 
                if not 30<=p2<=36: bad.append('seek')
            await pg.evaluate(f"Player.index={n}; Player.next(false,'test next')")
        # let one song run into the next by itself (the last 6 s of a song, then the start of the following one)
        await pg.evaluate("Player.seek(Player.dur()-6)"); i0=await pg.evaluate("Player.index"); await pg.wait_for_timeout(15000)
        st=await pg.evaluate("({i:Player.index, pos:Math.round(Player.pos()), paused:Player.audio.paused})")
        ok=st['i']==i0+1 and st['pos']>=3 and not st['paused']; print(f"  end of song -> next by itself: {'ok' if ok else 'PROBLEM'} {st}")
        if not ok: bad.append('song end')
        print('  events:', (await pg.evaluate("__ev"))[:8], '| messages:', (await pg.evaluate("__toasts"))[:3])
        print('  log:', [x[:60] for x in await pg.evaluate("(store.get('playlog')||[]).map(x=>x.why).reverse()")][:10])
        if errs: print('  page errors:', errs[:2])
        await br.close()
    print(f"RESULT [{NAME}{', iPhone rules' if IPHONE else ''}, {QUALITY}]:", 'OK' if not bad else 'PROBLEMS: '+', '.join(bad))
asyncio.run(main())
