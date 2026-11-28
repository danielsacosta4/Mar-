# 1.8.2: the iPhone after a phone call (music comes back by itself), and the phone audit fixes: no volume bar where it
# can't work, the quality picker changes the phone playback quality, nothing selectable by a long press, thumb-sized
# touch areas, the Library tab lit for everything listed in the Library.
# iOS is imitated: the page can't set the volume, and navigator.audioSession is a stand-in the test drives.
import asyncio, sys, os, json
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
get=lambda path: json.loads(urlopen(B+path).read())
INIT="""
Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});   // like iOS
(() => { const t=new EventTarget(); t.state='active'; t.type='auto';
  try { Object.defineProperty(Navigator.prototype,'audioSession',{configurable:true,get:()=>t}); } catch(e) {}
  try { Object.defineProperty(navigator,'audioSession',{configurable:true,get:()=>t}); } catch(e) {}
  window.__as=(s)=>{ t.state=s; t.dispatchEvent(new Event('statechange')); }; })();
window.__hid=false; Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hid});
"""
async def login(pg):
    await pg.goto(B); await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
    await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
async def main():
    get('__real?1'); problems=[]
    def check(label, ok, extra=''):
        print(('  ok      ' if ok else '  PROBLEM ')+label+(f'  {extra}' if extra else ''))
        if not ok: problems.append(label)
    async with async_playwright() as p:
        br=await launch(p, args=['--autoplay-policy=no-user-gesture-required']); errs=[]
        ctx=await br.new_context(**phone(p, 390, 844)); await ctx.add_init_script(INIT); pg=await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg); await pg.reload(); await pg.wait_for_selector('.shelf .card'); await pg.wait_for_timeout(1200)
        await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0'); await pg.wait_for_timeout(1500)
        playing=lambda: pg.evaluate("!Player.audio.paused")
        log=lambda n=4: pg.evaluate(f"(store.get('playlog')||[]).slice(0,{n}).map(x=>x.why)")
        async def settle(ms=2600): await pg.wait_for_timeout(ms)
        print('iPhone rules:', await pg.evaluate("[Player.volLocked, document.documentElement.className]"), '| playing:', await playing())

        print('== a call while Maré is on screen')
        await pg.evaluate("Player.seek(20)"); await pg.wait_for_timeout(600)
        await pg.evaluate("__as('interrupted'); Player.audio.pause()"); await pg.wait_for_timeout(500)
        check('the phone stopped the music and Maré noted why', not await playing() and await pg.evaluate("!!Player.interrupted"), str(await log(2)))
        await pg.evaluate("__as('active')"); await settle()
        pos=await pg.evaluate("Player.pos()")
        check('the music comes back by itself, at the same point', await playing() and 18<=pos<=30, 'at %.1f s' % pos)
        check('the log says so', any('resumed after a call' in x for x in await log()))

        print('== the pause arrives before the phone says "interrupted"')
        await pg.evaluate("Player.audio.pause()"); await pg.wait_for_timeout(300); await pg.evaluate("__as('interrupted')"); await pg.wait_for_timeout(300)
        await pg.evaluate("__as('active')"); await settle()
        check('comes back too', await playing())

        print('== paused by the listener, then a call')
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(400)
        await pg.evaluate("__as('interrupted')"); await pg.wait_for_timeout(300); await pg.evaluate("__as('active')"); await settle()
        check('stays paused', not await playing())
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(800)

        print('== the listener takes over during the call (plays, then pauses)')
        await pg.evaluate("__as('interrupted'); Player.audio.pause()"); await pg.wait_for_timeout(300)
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(500); await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(300)
        await pg.evaluate("__as('active')"); await settle()
        check('stays paused', not await playing())
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(800)

        print('== headphones taken out (a pause from the phone, no call)')
        await pg.evaluate("Player.audio.pause()"); await pg.wait_for_timeout(300); await pg.evaluate("__as('active')"); await settle(1500)
        check('nothing starts by itself', not await playing() and not await pg.evaluate("!!Player.interrupted"))
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(800)

        print('== a very long call')
        await pg.evaluate("__as('interrupted'); Player.audio.pause()"); await pg.wait_for_timeout(300)
        await pg.evaluate("Player.interrupted=Date.now()-16*60000; __as('active')"); await settle(1500)
        check('after more than 15 minutes it stays paused', not await playing() and any('more than 15 min' in x for x in await log()))
        await pg.evaluate("Player.toggle()"); await pg.wait_for_timeout(800)

        print('== a call with the phone locked, and iOS refuses to start the sound from there')
        await pg.evaluate("window.__hid=true; document.dispatchEvent(new Event('visibilitychange'))")
        await pg.evaluate("__as('interrupted'); Player.audio.pause()"); await pg.wait_for_timeout(300)
        await pg.evaluate("(()=>{ window.__play=HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play=function(){ return Promise.reject(new DOMException('not allowed','NotAllowedError')); }; })()")
        await pg.evaluate("__as('active')"); await settle(3200)
        check('still paused, and waiting for the screen', not await playing() and await pg.evaluate("Player.resumeOnShow===true"), str(await log(2)))
        await pg.evaluate("(()=>{ HTMLMediaElement.prototype.play=window.__play; window.__hid=false; document.dispatchEvent(new Event('visibilitychange')); })()"); await settle()
        check('starts the moment Maré is on screen again', await playing(), str(await log(2)))

        print('== the phone never said the call ended (page was frozen): back on screen')
        await pg.evaluate("window.__hid=true; document.dispatchEvent(new Event('visibilitychange')); __as('interrupted'); Player.audio.pause()"); await pg.wait_for_timeout(300)
        await pg.evaluate("navigator.audioSession.state='active'; window.__hid=false; document.dispatchEvent(new Event('visibilitychange'))"); await settle()
        check('starts again', await playing())

        print('== phone audit fixes')
        await pg.click('.player .p-title', force=True); await pg.wait_for_selector('.np .np-scrub'); await pg.wait_for_timeout(700)
        check('no volume bar in Now Playing on iPhone', await pg.evaluate("getComputedStyle(document.querySelector('.np-volume')).display==='none'"))
        t=await pg.evaluate("""(()=>{const r=q=>document.querySelector(q).getBoundingClientRect(); const a=r('#np .p-cur'), b=r('#np .np-quality'), c=r('#np .p-dur'); return [Math.round(b.left-a.right), Math.round(c.left-b.right), Math.round(innerWidth-c.right)]})()""")
        check('the quality label keeps clear of the times and the margin', t[0]>=6 and t[1]>=6 and t[2]>=20, str(t))
        await pg.click('#np .np-quality'); await pg.wait_for_timeout(400)
        items=await pg.eval_on_selector_all('#menu button', "e=>e.map(x=>x.textContent.trim())")
        check('the quality picker offers the phone playback qualities', len(items) in (2,3) and items[0].startswith('✓') and 'Original' in items[-1] and not any('Opus 96' in x for x in items), str(items))
        q0=await pg.evaluate("Prefs.get('quality')")
        await pg.click('#menu button >> nth=-1'); await pg.wait_for_timeout(2500)
        check('choosing Original (live) changes the phone setting and keeps playing', await pg.evaluate("Prefs.get('phoneQuality')==='original' && Prefs.get('quality')==='original' && !Ahead.phone()") and await playing())
        await pg.click('#np .np-quality'); await pg.wait_for_timeout(400)
        items=await pg.eval_on_selector_all('#menu button', "e=>e.map(x=>x.textContent.trim())")
        check('the picker now ticks Original', items[-1].startswith('✓'), str(items))
        await pg.click('#menu button >> nth=0'); await pg.wait_for_timeout(2500)
        check('back to saved copies', await pg.evaluate("(Prefs.get('phoneQuality')||'opus128')==='opus128' && Ahead.phone()") and await playing())
        await pg.evaluate(f"Prefs.set('quality',{json.dumps(q0)})")
        await pg.click('.np-tab[data-view="queue"]'); await pg.wait_for_timeout(500)
        h=await pg.evaluate("(()=>{const e=document.querySelector('#np-queue .q-head h3'); return e? Math.round(e.getBoundingClientRect().height):0})()")
        check('"Up Next" stays on one line', 0<h<60, f'{h} px')
        await pg.click('.np-tab[data-view="art"]'); await pg.evaluate("UI.closeNP&&UI.closeNP()"); await pg.wait_for_timeout(400)
        sel=await pg.evaluate("""(()=>{const u=q=>{const e=document.querySelector(q); if(!e) return 'missing'; const s=getComputedStyle(e); return s.webkitUserSelect||s.userSelect}; return {row:u('.track .t-title'), head:u('.section-head h2, .side-head, h1'), tab:u('.tabbar a')}})()""")
        check('song rows, headings and tabs can\'t be selected by a long press', all(v=='none' for v in sel.values()), str(sel))
        area=await pg.evaluate("""(()=>{const e=document.querySelector('.track .t-more'), r=e.getBoundingClientRect(), a=getComputedStyle(e,'::after'); return Math.round(r.width-2*parseFloat(a.left))})()""")
        check('the "…" on a song row has a 44 px touch area', area>=44, f'{area} px')
        await pg.locator('.track').nth(2).locator('.t-more').click(); await pg.wait_for_timeout(400)
        mh=await pg.evaluate("Math.round(document.querySelector('#menu button:not(.star)').getBoundingClientRect().height)")
        m=await pg.locator('#menu').bounding_box()
        check('menu lines are 44 px and the menu is on screen', mh>=44 and m['y']>=0 and m['y']+m['height']<=844, f'{mh} px, menu {round(m["y"])}–{round(m["y"]+m["height"])}')
        await pg.screenshot(path=f'{SP}/r10-menu.png'); await pg.keyboard.press('Escape'); await pg.mouse.click(5,5); await pg.wait_for_timeout(300)
        tabs={}
        for r in ['home','collection','settings','moments','downloads','genre/Fado','search']:
            await pg.goto(B+'#/'+r); await pg.wait_for_timeout(500); tabs[r]=await pg.eval_on_selector_all('.tabbar a.active', "e=>e.map(x=>x.textContent.trim()).join()")
        check('the Library tab is lit for everything that isn\'t Home or Search', tabs=={'home':'Home','search':'Search','collection':'Library','settings':'Library','moments':'Library','downloads':'Library','genre/Fado':'Library'}, str(tabs))
        await pg.goto(B+'#/settings'); await pg.wait_for_selector('.set-row'); await pg.wait_for_timeout(400)
        check('Settings on iPhone: no crossfade or levelling controls, one line instead', await pg.locator('[data-pref=crossfade], [data-pref=rg], [data-pref=smartFade]').count()==0 and await pg.locator('.set-row:has-text("Crossfade and volume levelling")').count()==1)
        await pg.screenshot(path=f'{SP}/r10-settings.png')
        await ctx.close()

        # A computer keeps what works there.
        ctx=await br.new_context(viewport={'width':1300,'height':860}); pg=await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg); await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0'); await pg.wait_for_timeout(800)
        check('computer: the volume bar is still there', await pg.evaluate("getComputedStyle(document.querySelector('.p-right .volume')).display!=='none' && !document.documentElement.classList.contains('vol-locked')"))
        await pg.click('.player .p-quality'); await pg.wait_for_timeout(300)
        items=await pg.eval_on_selector_all('#menu button', "e=>e.map(x=>x.textContent.trim())")
        check('computer: the quality picker is the streaming one (6 choices)', len(items)==6, str(items))
        await pg.keyboard.press('Escape'); await pg.goto(B+'#/settings'); await pg.wait_for_selector('[data-pref=crossfade]')
        check('computer: crossfade and levelling settings are there', await pg.locator('[data-pref=crossfade], [data-pref=rg], [data-pref=smartFade]').count()==3)
        if errs: problems.append('page errors: '+'; '.join(errs[:3]))
        print('RESULT:', 'OK' if not problems else 'PROBLEMS: '+' | '.join(problems))
        await br.close()
    get('__real?0')
asyncio.run(main())
