# 1.6.0: a long phone session. iPhone-sized, touch, CPU slowed down 4×, iPhone audio rules (no volume control → one
# player), songs as long as their tags, converted quality (Opus 128). Plays an album through, seeks, skips, goes to the
# background and back, loses the server and gets it back. Fails loudly on any stop, skip or slow moment.
import asyncio, sys, os, json, time
from urllib.request import urlopen
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
get=lambda path: json.loads(urlopen(B+path).read())
INIT="""
Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});   // like iOS
window.__lt=[]; try { new PerformanceObserver(l=>l.getEntries().forEach(e=>__lt.push(Math.round(e.duration)))).observe({type:'longtask',buffered:true}); } catch(e) {}
window.__hid=false; Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hid});
"""
async def main():
    get('__real?1')
    problems=[]
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        ctx=await br.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
        await ctx.add_init_script(INIT)
        pg=await ctx.new_page()
        pg.on('console', lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await pg.goto(B)
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.evaluate("Prefs.set('quality','opus128')")
        await pg.reload(); await pg.wait_for_selector('.shelf .card'); await pg.wait_for_timeout(1000)
        cdp=await ctx.new_cdp_session(pg)
        await cdp.send('Emulation.setCPUThrottlingRate',{'rate':4})
        print('iPhone mode:', await pg.evaluate("Player.volLocked"), '| service worker:', await pg.evaluate("!!navigator.serviceWorker.controller"))
        await pg.evaluate("window.__lt.length=0")
        t0=time.time()
        await pg.goto(B+'#/album/al2'); await pg.wait_for_selector('.track')
        print('album page on a slow phone: %.1f s' % (time.time()-t0))
        await pg.click('.track >> nth=0'); await pg.wait_for_timeout(1500)
        await pg.evaluate("Player.els.forEach(a=>{a.defaultPlaybackRate=4; a.playbackRate=4})")
        # Watch: every 0.5 s, is time moving while "playing"?
        await pg.evaluate("""window.__watch={stops:0,last:-1,same:0,songs:new Set(),samples:0};
          setInterval(()=>{const w=__watch, a=Player.audio; a.playbackRate=4; w.samples++; w.songs.add(Player.current()?.id);
            const t=Player.pos(); if(!a.paused && Math.abs(t-w.last)<0.05){ if(++w.same===6) w.stops++; } else w.same=0; w.last=t;},500)""")
        async def touch_seek(f):
            await pg.click('.player .p-title', force=True); await pg.wait_for_selector('.np .np-scrub'); await pg.wait_for_timeout(400)
            b=await pg.locator('.np .np-scrub').bounding_box(); pt=[{'x':b['x']+b['width']*f,'y':b['y']+b['height']/2}]
            await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':pt}); await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            await pg.wait_for_timeout(500); await pg.keyboard.press('Escape'); await pg.evaluate("UI.closeNP?.()")
        steps=[]
        await pg.wait_for_timeout(8000); steps.append(('played 8 s', await pg.evaluate("Player.pos()")))
        await touch_seek(0.6); steps.append(('tap seek 60%', await pg.evaluate("Math.round(Player.pos()/Player.dur()*100)")))
        await pg.wait_for_timeout(6000)
        await pg.evaluate("Player.next(false,'test skip')"); await pg.wait_for_timeout(4000); steps.append(('skip', await pg.evaluate("Player.current().id")))
        await pg.evaluate("window.__hid=true; document.dispatchEvent(new Event('visibilitychange'))"); await pg.wait_for_timeout(12000)
        steps.append(('12 s in background', await pg.evaluate("[Player.current().id, !Player.audio.paused]")))
        await pg.evaluate("window.__hid=false; document.dispatchEvent(new Event('visibilitychange'))"); await pg.wait_for_timeout(3000)
        await pg.wait_for_function("(async()=>(await (await caches.open('mare-ahead')).keys()).length>=1)()", timeout=60000)
        get('__down?1'); await pg.evaluate("Player.next(false,'test skip')"); await pg.wait_for_timeout(6000)
        steps.append(('server gone, next song', await pg.evaluate("[Player.current().id, !Player.audio.paused, Player.diag()]")))
        get('__down?0'); await pg.wait_for_timeout(16000)
        steps.append(('server back', await pg.evaluate("[!Offline.offline, !Player.audio.paused]")))
        await pg.wait_for_timeout(20000)
        w=await pg.evaluate("({stops:__watch.stops, songs:[...__watch.songs].length, samples:__watch.samples})")
        log=await pg.evaluate("(store.get('playlog')||[]).map(x=>x.why)")
        lt=await pg.evaluate("__lt")
        ls=await pg.evaluate("Object.keys(localStorage).reduce((t,k)=>t+localStorage.getItem(k).length,0)")
        streams=[x for x in get('__log') if x.startswith('stream so2')]
        for s in steps: print('step:', s)
        print('watch:', w, '| long tasks >100 ms:', len([x for x in lt if x>100]), '| longest: %s ms' % (max(lt) if lt else 0), '| localStorage: %d KB' % (ls//1024))
        print('streams all with size estimate:', all(x.endswith(' est') for x in streams if ' opus' in x or ' mp3' in x), '|', streams[:3])
        print('log:', log[:14])
        if w['stops']: problems.append(f"{w['stops']} unexpected stop(s)")
        if any('skipped after error' in x for x in log): problems.append('a song was skipped after an error')
        if not steps[-1][1][0] or not steps[-1][1][1]: problems.append('did not recover when the server came back')
        if errs: problems.append('console errors: '+'; '.join(errs[:3]))
        print('RESULT:', 'OK' if not problems else 'PROBLEMS: '+' | '.join(problems))
        await br.close()
    get('__real?0'); get('__down?0')
asyncio.run(main())
