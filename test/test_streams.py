# How songs behave when the server streams like the real Navidrome (/__navi?1): real FLAC originals, and converted
# Opus / MP3 produced by ffmpeg as it goes, with and without the "estimated size". iPhone rules (one player, no volume).
# For each case: does song 1 play to its real end, how does it hand over to song 2, and what does the log say?
import asyncio, sys, os, json
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, WEBKIT, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
get=lambda path: json.loads(urlopen(B+path).read())
INIT="Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});"   # like iOS
CASES=[('original',None),('opus128',True),('opus128',False),('high',True),('high',False)]
async def main():
    get('__navi?1')
    bad=[]
    async with async_playwright() as p:
        br=await launch(p, args=['--autoplay-policy=no-user-gesture-required'])
        for quality,est in CASES:
            name=f"{quality}{'' if est is None else ' + size estimate' if est else ' no size'}"
            ctx=await br.new_context(**phone(p)); await ctx.add_init_script(INIT)
            pg=await ctx.new_page(); errs=[]
            pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
            await pg.goto(B)
            await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
            await pg.evaluate(f"Prefs.set('quality','{quality}'); Prefs.set('ahead', false); localStorage.removeItem('mare.playlog')")
            if est is False:
                await pg.evaluate("const st=API.stream.bind(API); API.stream=(id,x)=>{ if(x){ x={...x}; delete x.estimateContentLength; } return st(id,x); }")
            n0=len(get('__log'))
            await pg.goto(B+'#/album/al2'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0')
            await pg.evaluate("""window.__w={max:{},toasts:[],silent:0,last:-1,lastId:null,t0:Date.now(),events:[]};
              const el=Player.audio; ['error','ended','stalled','waiting'].forEach(ev=>el.addEventListener(ev,()=>__w.events.push(ev+(ev==='error'?' '+(el.error&&el.error.code):'')+'@'+Math.round(Player.pos()))));
              const tt=window.toast; window.toast=(m)=>{__w.toasts.push(m); return tt(m)};
              setInterval(()=>{const w=__w,a=Player.audio,id=Player.current()&&Player.current().id; a.playbackRate=4; const t=Player.pos();
                w.max[id]=Math.max(w.max[id]||0,t); if(id===w.lastId && Math.abs(t-w.last)<0.02) w.silent+=0.25; w.last=t; w.lastId=id;},250)""")
            # song 1 is 47 s (12 s at 4x); wait until song 2 has played a while, or 40 s
            try: await pg.wait_for_function("Player.index>=1 && Player.pos()>8", timeout=40000)
            except Exception: pass
            r=await pg.evaluate("({w:__w, idx:Player.index, pos:Math.round(Player.pos()), dur:Player.queue[0].duration, paused:Player.audio.paused, log:(store.get('playlog')||[]).map(x=>x.why).reverse()})")
            navi=[x for x in get('__log')[n0:] if x.startswith('navi')]
            first=r['w']['max'].get('so2_1',0)
            ok = r['idx']>=1 and first>=r['dur']-3 and not r['w']['toasts'] and r['w']['silent']<=2.5
            print(f"--- {name} [{NAME}]: {'OK' if ok else 'PROBLEM'}")
            print(f"    song 1 played to {first:.0f} of {r['dur']} s | reached song 2: {r['idx']>=1} | silent for {r['w']['silent']:.1f} s | paused now: {r['paused']}")
            print('    events:', r['w']['events'][:10], '| messages:', r['w']['toasts'][:3])
            print('    log:', [x[:70] for x in r['log']][:8])
            for x in navi[:4]: print('    server:', x)
            if errs: print('    page errors:', errs[:2])
            if not ok: bad.append(name)
            await ctx.close()
        await br.close()
    get('__navi?0')
    print('RESULT:', 'OK' if not bad else 'PROBLEMS in: '+', '.join(bad))
asyncio.run(main())
