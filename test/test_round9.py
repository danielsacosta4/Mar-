# 1.8.1: three dots on the playing song (phone), no text selection on long press, shuffle (artists apart, endless
# library shuffle that favours unheard songs), and the artists-per-country globe on the Collection page.
import asyncio, sys, os, json
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, tap, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
async def login(pg):
    await pg.goto(B); await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
    await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
async def main():
    async with async_playwright() as p:
        br=await launch(p, args=['--autoplay-policy=no-user-gesture-required']); errs=[]
        # ---------- phone: the three dots ----------
        ctx=await br.new_context(**phone(p)); pg=await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg)
        await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0'); await pg.wait_for_timeout(1000)
        b=await pg.locator('.p-mini-more').bounding_box()
        print('mob mini player has "…":', bool(b and b['width']>30), '| player text selectable:', await pg.evaluate("getComputedStyle(document.querySelector('.p-title')).webkitUserSelect || getComputedStyle(document.querySelector('.p-title')).userSelect"))
        await pg.click('.p-mini-more'); await pg.wait_for_timeout(400)
        items=await pg.eval_on_selector_all('#menu [data-mi], #menu .menu-item', "e=>e.map(x=>x.textContent.trim()).filter(Boolean)")
        m=await pg.locator('#menu').bounding_box(); vp=pg.viewport_size
        print('mob menu from the mini player:', items[:4], '| stars in it:', await pg.locator('#menu .star').count(), '| inside the screen:', bool(m and m['y']>=0 and m['y']+m['height']<=vp['height']+1))
        await pg.screenshot(path=f'{SP}/r9-mini-menu.png'); await pg.keyboard.press('Escape'); await pg.mouse.click(5,5); await pg.wait_for_timeout(300)
        await pg.click('.player .p-title', force=True); await pg.wait_for_selector('.np .np-more-big'); await pg.wait_for_timeout(600)
        b=await pg.locator('.np-more-big').bounding_box()
        await pg.click('.np-more-big'); await pg.wait_for_timeout(400)
        print('mob Now Playing "…" by the heart:', bool(b and b['width']>=36), '| opens the menu:', await pg.locator('#menu .star').count()>0)
        await pg.screenshot(path=f'{SP}/r9-np-menu.png')
        await ctx.close()
        # ---------- shuffle ----------
        ctx=await br.new_context(viewport={'width':1300,'height':860}); pg=await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg)
        r=await pg.evaluate("""()=>{ const mk=(a,n)=>Array.from({length:n},(_,i)=>({id:a+i,artist:a,title:a+i}));
          const list=[...mk('A',6),...mk('B',6),...mk('C',6)]; let worst=0;
          for(let k=0;k<200;k++){ const q=shuffled(list); let adj=0; for(let i=1;i<q.length;i++) if(q[i].artist===q[i-1].artist) adj++; worst=Math.max(worst,adj); }
          const firsts={}; for(let k=0;k<3000;k++){ const f=shuffled(list)[0].id; firsts[f]=(firsts[f]||0)+1; }
          const one=shuffled([...mk('A',12),...mk('B',3)]); let adj1=0; for(let i=1;i<one.length;i++) if(one[i].artist===one[i-1].artist) adj1++;
          const c=Object.values(firsts); return {worst, distinctFirst:c.length, min:Math.min(...c), max:Math.max(...c), adj1, len:one.length}; }""")
        print('shuffle: one artist with 12 of 15 songs still plays all', r['len'], '| unavoidable repeats there:', r['adj1'])
        print('shuffle: same artist back to back, worst of 200 shuffles:', r['worst'], '| every song can come first:', r['distinctFirst']==18, f"(each {r['min']}-{r['max']} times of 3000)")
        r=await pg.evaluate("""()=>{ const now=Date.now(), D=864e5; const pool=[];
          for(let i=0;i<100;i++) pool.push({id:'never'+i}); for(let i=0;i<100;i++) pool.push({id:'today'+i,played:new Date(now-3600e3).toISOString()});
          for(let i=0;i<100;i++) pool.push({id:'old'+i,played:new Date(now-200*D).toISOString()});
          let n=0,t=0,o=0; for(let k=0;k<50;k++) favourUnheard(pool,100).forEach(s=>{ if(s.id.startsWith('never')) n++; else if(s.id.startsWith('today')) t++; else o++; });
          return {never:Math.round(n/50), today:Math.round(t/50), old:Math.round(o/50)}; }""")
        print('favour unheard, of 100 picked from 100 never / 100 long ago / 100 played today:', r)
        await pg.goto(B+'#/'); await pg.wait_for_selector('[data-act="mix-library"]'); await pg.click('[data-act="mix-library"]')
        await pg.wait_for_function("Player.queue.length>20", timeout=15000)
        q0=await pg.evaluate("Player.queue.length"); lab=await pg.evaluate("Radio.label()")
        await pg.evaluate("Player.index=Player.queue.length-3; Player.load(true)"); 
        try: await pg.wait_for_function(f"Player.queue.length>{q0}", timeout=15000)
        except Exception: pass
        q1=await pg.evaluate("Player.queue.length"); dup=await pg.evaluate("Player.queue.length-new Set(Player.queue.map(s=>s.id)).size")
        print('library shuffle:', lab, '| queue', q0, '-> grows near its end to', q1, '| repeats:', dup, '(the test library only has 96 songs, so a refill has to repeat)')
        # ---------- the globe ----------
        await pg.evaluate("MB.gap=30; localStorage.removeItem('mare.geo'); Geo.d=null")
        await pg.goto(B+'#/collection'); await pg.wait_for_selector('.atlas .globe', timeout=20000)
        await pg.wait_for_function("!Geo.running && document.querySelector('.atlas-note').textContent.includes('placed')", timeout=30000)
        print('globe: countries drawn', await pg.locator('.globe .gl-c').count(), '| note:', (await pg.text_content('.atlas-note')).strip()[:110])
        print('globe: found', await pg.evaluate("Object.fromEntries(Object.entries(Geo.data().a).sort())"))
        print('globe: ranked list', await pg.eval_on_selector_all('.atlas-row', "e=>e.map(x=>x.querySelector('.atlas-name').textContent+' '+x.querySelector('.atlas-count').textContent)"))
        print('globe: selected by default:', await pg.text_content('.atlas-sel h3'), '| artists:', await pg.eval_on_selector_all('.atlas-sel .chip', "e=>e.map(x=>x.textContent)"))
        d0=await pg.get_attribute('.globe .gl-c[data-c="US"]','d'); rot0=await pg.evaluate("Atlas.rot.slice()")
        await pg.click('.atlas-row[data-c="US"]'); await pg.wait_for_timeout(1000)
        box=await pg.locator('.globe').bounding_box(); us=await pg.locator('.globe .gl-c[data-c="US"]').bounding_box()
        print('globe: pick United States from the list ->', await pg.text_content('.atlas-sel h3'), '| globe turned to it:', bool(us and abs((us['x']+us['width']/2)-(box['x']+box['width']/2))<box['width']*0.2), '| marked:', 'on' in (await pg.get_attribute('.globe .gl-c[data-c="US"]','class')))
        await pg.screenshot(path=f'{SP}/r9-globe.png', full_page=False)
        await pg.evaluate("document.querySelector('.atlas').scrollIntoView()"); await pg.wait_for_timeout(300)
        await pg.locator('.atlas').screenshot(path=f'{SP}/r9-globe-section.png')
        # drag turns it; a click on a country with artists selects it
        box=await pg.locator('.globe').bounding_box(); cx=box['x']+box['width']/2; cy=box['y']+box['height']/2; r1=await pg.evaluate("Atlas.rot[0]")
        await pg.mouse.move(cx,cy); await pg.mouse.down(); await pg.mouse.move(cx+120,cy,steps=6); await pg.mouse.up(); await pg.wait_for_timeout(300)
        print('globe: drag turns it by', round(await pg.evaluate("Atlas.rot[0]")-r1), 'degrees | still United States:', await pg.text_content('.atlas-sel h3'))
        await pg.click('.atlas-row[data-c="PT"]'); await pg.wait_for_timeout(900)
        pt=await pg.locator('.globe .gl-c[data-c="NO"]').bounding_box()
        if pt: await pg.mouse.click(pt['x']+pt['width']/2, pt['y']+pt['height']*0.75); await pg.wait_for_timeout(900)
        print('globe: click on Norway ->', await pg.text_content('.atlas-sel h3'))
        await pg.click('.atlas-row[data-c="-"]'); await pg.wait_for_timeout(300)
        print('globe: not found group ->', await pg.text_content('.atlas-sel h3'), await pg.eval_on_selector_all('.atlas-sel .chip', "e=>e.map(x=>x.textContent)"))
        await pg.click('[data-act="atlas-retry"]'); await pg.wait_for_timeout(600)
        await pg.wait_for_function("!Geo.running && document.querySelector('.atlas-note').textContent.includes('placed')", timeout=20000)
        print('globe: "try them again" asks only about the missing one ->', await pg.evaluate("Object.values(Geo.data().a).sort().join(' ')"))
        n=len([x for x in json.loads(urlopen(B+'__log').read()) if x.startswith('MB a')])
        await pg.goto(B+'#/'); await pg.goto(B+'#/collection'); await pg.wait_for_selector('.atlas .globe'); await pg.wait_for_timeout(1200)
        print('globe: second visit asks MusicBrainz again:', len([x for x in json.loads(urlopen(B+'__log').read()) if x.startswith('MB a')])-n, 'times')
        await ctx.close()
        # phone layout
        ctx=await br.new_context(**phone(p)); pg=await ctx.new_page(); await login(pg)
        await pg.evaluate("MB.gap=30"); await pg.goto(B+'#/collection'); await pg.wait_for_selector('.atlas .globe', timeout=20000)
        await pg.wait_for_function("!Geo.running && document.querySelector('.atlas-note').textContent.includes('placed')", timeout=30000)
        await pg.evaluate("document.querySelector('.atlas').scrollIntoView()"); await pg.wait_for_timeout(400)
        g=await pg.locator('.globe').bounding_box(); print('mob globe width:', round(g['width']), 'of', pg.viewport_size['width'], '| page scrolls sideways:', await pg.evaluate("document.documentElement.scrollWidth>innerWidth+1"))
        await pg.screenshot(path=f'{SP}/r9-globe-mob.png')
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
