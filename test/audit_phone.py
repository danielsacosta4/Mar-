# Phone audit: walks every screen at phone size and measures what a thumb and an eye would notice. Not a pass/fail
# suite: it prints findings per screen and saves a screenshot of each (top and bottom of the page) to look at.
#   python3 test/audit_phone.py [out-dir]      MARE_BROWSER=webkit for Safari's engine; AUDIT_SIZE=375x667, AUDIT_SCHEME=dark
import asyncio, sys, os, json, time
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, slow_cpu, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output/audit'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
W,H=[int(x) for x in os.environ.get('AUDIT_SIZE','390x844').split('x')]; SCHEME=os.environ.get('AUDIT_SCHEME','light')
TAG=f"{NAME[:2]}-{W}-{SCHEME[0]}"
get=lambda path: json.loads(urlopen(B+path).read())
INIT="Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});"   # like iOS

PAGES=[('home','#/home','.shelf .card'),('library','#/library','.main a'),('albums','#/albums','.card'),('artists','#/artists','.main a'),
  ('songs','#/songs','.track'),('favorites','#/favorites','.main'),('playlists','#/playlists','.main'),('playlist','#/playlist/pl1','.track'),
  ('album','#/album/al2','.track'),('artist','#/artist/ar3','.main h1'),('genre','#/genre/Fado','.main'),('decade','#/decade/1990','.main'),
  ('search','#/search?q=fado','.main'),('search-empty','#/search','.main'),('downloads','#/downloads','.main'),('settings','#/settings','.main'),
  ('collection','#/collection','.tile'),('collection-list','#/collection/cd','.main'),('new','#/new','.main'),('shopping','#/shopping','.main'),
  ('moments','#/moments','.main'),('year','#/year/2025','.main')]

MEASURE=r"""(opts) => {
  const W=innerWidth, H=innerHeight, out={};
  const vis=(e)=>{ const r=e.getBoundingClientRect(), s=getComputedStyle(e); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>0.05; };
  const name=(e)=>{ let n=e.tagName.toLowerCase(); if(e.id) n+='#'+e.id; const c=[...e.classList].slice(0,3).join('.'); if(c) n+='.'+c;
    const a=e.getAttribute('data-act'); if(a) n+=`[${a}]`; return n; };
  const where=(e)=>{ const p=e.parentElement; return (p&&p!==document.body? name(p)+' > ':'')+name(e); };
  const root=document.querySelector(opts.root)||document.body;
  const clipped=(e)=>{ for(let p=e.parentElement;p&&p!==document.documentElement;p=p.parentElement){ const s=getComputedStyle(p);
    if(/(auto|scroll|hidden|clip)/.test(s.overflowX)){ const r=p.getBoundingClientRect(); if(r.right<=W+1&&r.left>=-1) return true; } } return false; };
  // 1. sideways overflow
  out.docWider=Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)-W;
  const wide=new Map();
  root.querySelectorAll('*').forEach((e)=>{ if(!vis(e)) return; const r=e.getBoundingClientRect();
    if((r.right>W+1||r.left<-1)&&!clipped(e)){ const k=where(e); if(!wide.has(k)) wide.set(k, Math.round(Math.max(r.right-W,-r.left))); } });
  out.offscreen=[...wide].slice(0,8);
  // 2. things to tap that are smaller than a thumb
  const small=new Map();
  root.querySelectorAll('a[href],button,[data-act],input,select,summary,[role=button]').forEach((e)=>{ if(!vis(e)) return;
    if(e.closest('p,li,.liner,.section-note,.np-lyrics')&&e.tagName==='A') return;       // links inside running text
    let r=e.getBoundingClientRect(); if(r.bottom<0||r.top>H*6) return;
    // a touch area drawn around a small thing (::after with negative insets) counts as its size
    const af=getComputedStyle(e,'::after'); let w=r.width, h=r.height;
    if(af.content!=='none'&&af.position==='absolute'){ const n=(v)=>Math.max(0,-(parseFloat(v)||0)); w+=n(af.left)+n(af.right); h+=n(af.top)+n(af.bottom); }
    r={width:w,height:h}; const m=Math.min(w,h);
    if(m<40){ const k=where(e); const v=small.get(k); if(!v||m<v[0]) small.set(k,[Math.round(m), Math.round(r.width)+'x'+Math.round(r.height)]); } });
  out.smallTaps=[...small].map(([k,v])=>[k,v[1]]).sort((a,b)=>parseInt(a[1])-parseInt(b[1])).slice(0,14);
  // 3. tiny text
  const tiny=new Map(); const tw=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  for(let n=tw.nextNode();n;n=tw.nextNode()){ const e=n.parentElement; if(!n.nodeValue.trim()||!e||!vis(e)) continue;
    const f=parseFloat(getComputedStyle(e).fontSize); if(f<11){ const k=where(e); if(!tiny.has(k)) tiny.set(k,f); } }
  out.tinyText=[...tiny].slice(0,10);
  // 4. text cut off without "…"
  const cut=new Map();
  root.querySelectorAll('*').forEach((e)=>{ if(!vis(e)||!e.childNodes.length||e.children.length>3) return; const s=getComputedStyle(e);
    if(!e.textContent.trim()) return;
    const hid=/(hidden|clip)/.test(s.overflowX);
    if(hid&&e.scrollWidth>e.clientWidth+2&&s.textOverflow!=='ellipsis'&&s.whiteSpace==='nowrap') cut.set(where(e),'sideways, no …');
    else if(/(hidden|clip)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+3&&!s.webkitLineClamp?.match(/\d/)&&e.children.length===0) cut.set(where(e),'bottom cut'); });
  out.cutText=[...cut].slice(0,8);
  // 5. selectable text where a long press shouldn't select
  const sel=[]; ['.card-title','.track-title','.t-title','.p-title','.np-title','.chart-row','.q-item','.tile','.tabbar a','.section-head h2','.btn','.menu-item'].forEach((q)=>{
    const e=root.querySelector(q)||document.querySelector(q); if(!e||!vis(e)) return; const s=getComputedStyle(e); const u=s.webkitUserSelect||s.userSelect; if(u!=='none') sel.push(q); });
  out.selectable=sel;
  return out;
}"""
BOTTOM=r"""() => {
  const m=document.querySelector('.main'); if(!m) return null;
  let e=m; while(e.lastElementChild){ let c=e.lastElementChild; while(c&&!(c.getBoundingClientRect().height>0)) c=c.previousElementSibling; if(!c) break; e=c; }
  const bars=['.player','.tabbar','.offline-bar'].map((q)=>document.querySelector(q)).filter((b)=>b&&getComputedStyle(b).display!=='none'&&b.getBoundingClientRect().height>0);
  const top=Math.min(innerHeight,...bars.map((b)=>b.getBoundingClientRect().top));
  return { lastBottom: Math.round(e.getBoundingClientRect().bottom), barsTop: Math.round(top), scrolls: m.scrollHeight>m.clientHeight+2, pageH: m.scrollHeight };
}"""

def show(label, m, extra=''):
    bits=[]
    if m.get('docWider',0)>1: bits.append(f"PAGE WIDER THAN SCREEN by {m['docWider']} px")
    if m.get('offscreen'): bits.append('off screen: '+'; '.join(f'{k} (+{v})' for k,v in m['offscreen']))
    if m.get('smallTaps'): bits.append('small taps: '+'; '.join(f'{k} {v}' for k,v in m['smallTaps']))
    if m.get('tinyText'): bits.append('tiny text: '+'; '.join(f'{k} {v}px' for k,v in m['tinyText']))
    if m.get('cutText'): bits.append('cut text: '+'; '.join(f'{k} ({v})' for k,v in m['cutText']))
    if m.get('selectable'): bits.append('selectable: '+', '.join(m['selectable']))
    print(f"[{TAG}] {label}{extra}" + (''.join('\n     - '+b for b in bits) if bits else '  clean'))

async def main():
    async with async_playwright() as p:
        br=await launch(p, args=['--autoplay-policy=no-user-gesture-required']); errs=[]
        prof=phone(p, W, H); prof['device_scale_factor']=float(os.environ.get('AUDIT_SCALE','1'))
        ctx=await br.new_context(**prof, color_scheme=SCHEME); await ctx.add_init_script(INIT)
        pg=await ctx.new_page()
        pg.on('console', lambda m: m.type=='error' and 'Failed to load resource' not in m.text and 'ERR_' not in m.text and errs.append(m.text[:160]))
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {str(e)[:160]}'))
        await pg.goto(B); await pg.wait_for_selector('input[name=user]'); await pg.wait_for_timeout(400)
        show('sign-in', await pg.evaluate(MEASURE, {'root':'body'})); await pg.screenshot(path=f'{SP}/{TAG}-00-signin.png')
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.wait_for_timeout(400)
        show('welcome sheet', await pg.evaluate(MEASURE, {'root':'.sheet'})); await pg.screenshot(path=f'{SP}/{TAG}-01-sheet.png')
        await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.evaluate("localStorage.setItem('mare.lb', JSON.stringify({user:'modren12',token:'good'})); if(window.MB) MB.gap=30")
        await pg.reload(); await pg.wait_for_selector('.shelf .card'); await pg.wait_for_timeout(1500)
        await pg.evaluate("if(window.MB) MB.gap=30")
        throttled=await slow_cpu(ctx, pg, 4)
        # something playing, so the mini player is there like in real use
        await pg.goto(B+'#/album/al2'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=1'); await pg.wait_for_timeout(1200)
        n=2
        for label,route,sel in PAGES:
            t0=time.time(); await pg.goto(B+route)
            try: await pg.wait_for_selector(sel, timeout=15000)
            except Exception: print(f'[{TAG}] {label}: "{sel}" never appeared')
            dt=time.time()-t0; await pg.wait_for_timeout(1800 if label in ('collection','year','moments','shopping','new','home','artist') else 700)
            await pg.evaluate("document.querySelector('.main')&&(document.querySelector('.main').scrollTop=0)")
            m=await pg.evaluate(MEASURE, {'root':'.app'}); await pg.screenshot(path=f'{SP}/{TAG}-{n:02d}-{label}.png')
            await pg.evaluate("(()=>{const m=document.querySelector('.main'); if(m){m.style.scrollBehavior='auto'; m.scrollTop=m.scrollHeight;} window.scrollTo(0,document.documentElement.scrollHeight)})()")
            await pg.wait_for_timeout(450); b=await pg.evaluate(BOTTOM); await pg.screenshot(path=f'{SP}/{TAG}-{n:02d}-{label}-end.png')
            extra=f"  ({dt:.1f} s{' slowed' if throttled else ''}, page {b['pageH']} px)" if b else ''
            if b and b['scrolls'] and b['lastBottom']>b['barsTop']+1: extra+=f"  LAST ITEM UNDER THE BARS by {b['lastBottom']-b['barsTop']} px"
            show(label, m, extra); n+=1
        # ---- menus and sheets
        await pg.goto(B+'#/album/al2'); await pg.wait_for_selector('.track'); await pg.wait_for_timeout(500)
        async def overlay(label, sel, root):
            await pg.wait_for_timeout(450); m=await pg.evaluate(MEASURE, {'root':root})
            box=await pg.locator(root).first.bounding_box()
            inside=bool(box and box['x']>=-1 and box['y']>=-1 and box['x']+box['width']<=W+1 and box['y']+box['height']<=H+1)
            await pg.screenshot(path=f'{SP}/{TAG}-m-{label}.png'); show(label, m, '' if inside else f'  NOT FULLY ON SCREEN {box}')
        try:
            await pg.locator('.track').nth(2).locator('.t-more').click(timeout=3000); await overlay('song menu','', '#menu')
            await pg.keyboard.press('Escape'); await pg.mouse.click(5,5)
        except Exception as e: print(f'[{TAG}] song menu: could not open ({str(e)[:80]})')
        await pg.wait_for_timeout(300)
        await pg.click('.p-mini-more'); await overlay('mini player menu','', '#menu')
        try:
            await pg.click('#menu button:has-text("Playlist")', timeout=2000); await overlay('add to playlist','', '#menu, .sheet')
        except Exception as e: print(f'[{TAG}] add to playlist: {str(e)[:80]}')
        await pg.keyboard.press('Escape'); await pg.mouse.click(5,5); await pg.wait_for_timeout(300)
        # ---- Now Playing
        await pg.evaluate("document.querySelector('#menu')&&UI.closeMenu&&UI.closeMenu()")
        await pg.click('.player .p-title', force=True); await pg.wait_for_selector('.np .np-scrub'); await pg.wait_for_timeout(900)
        for view in ['art','lyrics','queue']:
            await pg.click(f'.np-tab[data-view="{view}"]'); await pg.wait_for_timeout(900)
            m=await pg.evaluate(MEASURE, {'root':'#np'}); await pg.screenshot(path=f'{SP}/{TAG}-np-{view}.png')
            g=await pg.evaluate("""()=>{ const r=(q)=>{const e=document.querySelector(q); if(!e) return null; const b=e.getBoundingClientRect(); return b.height? [Math.round(b.top),Math.round(b.bottom),Math.round(b.left),Math.round(b.right)]:null};
              return {art:r('#np .np-art'),title:r('#np .np-title'),scrub:r('#np .np-scrub'),buttons:r('#np .np-buttons'),volume:r('#np .np-volume'),controls:r('#np .np-controls'),body:r('#np .np-art-wrap')||r('#np .np-lyrics')||r('#np .np-queue'),top:r('#np .np-top'),h:innerHeight} }""")
            show(f'now playing: {view}', m, f"  {g}")
        try:
            await pg.click('#np .np-quality', timeout=2000); await overlay('quality picker','', '#menu, .sheet'); await pg.keyboard.press('Escape'); await pg.mouse.click(5,5)
        except Exception as e: print(f'[{TAG}] quality picker: {str(e)[:80]}')
        await pg.wait_for_timeout(300)
        await pg.click('.np-tab[data-view="art"]'); await pg.click('.np-more-big'); await overlay('now playing menu','', '#menu')
        await pg.keyboard.press('Escape'); await pg.mouse.click(5,5); await pg.wait_for_timeout(300)
        await pg.evaluate("UI.closeNP&&UI.closeNP()"); await pg.wait_for_timeout(400)
        # ---- offline
        get('__down?1'); await pg.goto(B+'#/albums'); await pg.wait_for_timeout(2500)
        show('offline', await pg.evaluate(MEASURE, {'root':'.app'})); await pg.screenshot(path=f'{SP}/{TAG}-zz-offline.png'); get('__down?0')
        print(f'[{TAG}] page errors:', errs[:6] if errs else 'none')
        await br.close()
asyncio.run(main())
