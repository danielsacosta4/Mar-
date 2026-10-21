# 1.5.18: iPhone player. Tap-to-seek on the progress bar, reloads keep their place, saved-ahead songs only when offline.
import asyncio, sys, os, json
from urllib.request import urlopen
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
get=lambda path: json.loads(urlopen(B+path).read())
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        ctx=await br.new_context(viewport={'width':390,'height':844},has_touch=True,is_mobile=True)
        pg=await ctx.new_page()
        pg.on('console', lambda m: m.type=='error' and 'TUNNEL' not in m.text and 'Failed to load resource' not in m.text and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await pg.goto(B)
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.reload(); await pg.wait_for_timeout(1500)   # service worker in control
        await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0'); await pg.wait_for_timeout(1200)
        await pg.evaluate("Player.volLocked=true")
        # Tap at 75% of the Now Playing bar (a tap, not a drag on the knob).
        await pg.click('.player .p-info, .player .p-title', force=True); await pg.wait_for_selector('.np .np-scrub'); await pg.wait_for_timeout(600)
        b=await pg.locator('.np .np-scrub').bounding_box()
        c=await ctx.new_cdp_session(pg)
        pt=[{'x':b['x']+b['width']*0.75,'y':b['y']+b['height']/2}]
        await c.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':pt}); await pg.wait_for_timeout(80)
        await c.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]}); await pg.wait_for_timeout(600)
        print('tap at 75%% → %.0f%%' % (await pg.evaluate("Player.pos()/Player.dur()*100")), '| scrubbing stuck:', await pg.evaluate("UI.scrubbing"))
        # A reload (headphone fix) keeps the position.
        await pg.evaluate("Player.seek(5)"); await pg.wait_for_timeout(300)
        await pg.evaluate("Player.lastReload=0; Player.refresh('test reload')"); await pg.wait_for_timeout(2000)
        print('after reload: %.1f s (was 5)' % await pg.evaluate("Player.pos()"), '| playing:', not await pg.evaluate("Player.audio.paused"))
        # In the background (document hidden): refresh really reloads now, and again when back on screen.
        await pg.evaluate("window.__hid=true; Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hid}); Player.seek(4)"); await pg.wait_for_timeout(300)
        await pg.evaluate("Player.lastReload=0; Player.refresh('resumed after headphones')"); await pg.wait_for_timeout(1500)
        print('hidden refresh: %.1f s (was 4)' % await pg.evaluate("Player.pos()"), '| flag:', await pg.evaluate("Player.lockedNudge"))
        await pg.evaluate("window.__hid=false; document.dispatchEvent(new Event('visibilitychange'))"); await pg.wait_for_timeout(1500)
        print('back on screen:', await pg.evaluate("(store.get('playlog')||[]).slice(0,3).map(x=>x.why)"), '| flag:', await pg.evaluate("Player.lockedNudge"))
        # Saved ahead: copies exist, but online playback comes from the server.
        await pg.wait_for_function("(async()=>(await (await caches.open('mare-ahead')).keys()).length>=2)()", timeout=20000)
        keys=await pg.evaluate("(async()=>(await (await caches.open('mare-ahead')).keys()).map(r=>new URL(r.url).pathname))()")
        print('ahead saved at download quality:', [x for x in get('__log') if x.startswith('stream so1_3')][:1])
        n0=len(get('__log'))
        await pg.evaluate("Player.next(false,'test')"); await pg.wait_for_timeout(1200)
        online=[x for x in get('__log')[n0:] if x.startswith('stream so')]
        print('ahead keys:', keys[:3], '| stream requests after next (server):', online[:2])
        # Server unreachable: the next song plays from the saved copy.
        get('__down?1')
        await pg.evaluate("Player.next(false,'test')"); await pg.wait_for_timeout(2500)
        print('offline next song:', await pg.evaluate("Player.current().id"), '| playing:', not await pg.evaluate("Player.audio.paused"), '| time moving:', await pg.evaluate("Player.pos()>0.3"))
        get('__down?0')
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
