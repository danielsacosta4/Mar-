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
