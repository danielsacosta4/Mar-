# 1.5.16: instant front page, play counts, ratings sent to ListenBrainz (5★ = Love) and MusicBrainz (exact stars).
import asyncio, sys, os, json
from urllib.request import urlopen
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
sent=lambda: json.loads(urlopen(B+'__sent').read())
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch()
        errs=[]
        ctx=await br.new_context(viewport={'width':1300,'height':860})
        pg=await ctx.new_page()
        pg.on('console', lambda m: m.type=='error' and 'TUNNEL' not in m.text and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await pg.goto(B)
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.evaluate("localStorage.setItem('mare.lb', JSON.stringify({user:'modren12',token:'good'}))")
        # Front page remembered: after a reload it is drawn before any fresh data arrives.
        await pg.goto(B+'#/'); await pg.wait_for_selector('#front .feature-title'); await pg.wait_for_timeout(1500)
        print('front saved:', await pg.evaluate("!!localStorage.getItem('mare.front')"))
        async def slow(r):
            await asyncio.sleep(3)
            try: await r.continue_()
            except Exception: pass
        await pg.route('**/rest/getAlbumList2*', slow)
        await pg.reload(); await pg.wait_for_timeout(900)
        print('front at 0.9 s while the server is slow:', await pg.locator('#front .feature-title').count(), '| skeleton:', await pg.locator('#front.skel-front').count())
        await pg.unroute('**/rest/getAlbumList2*')
        # Play counts
        await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track')
        print('track plays:', await pg.locator('.t-plays').count(), '|', (await pg.locator('.t-plays').first.text_content()).strip(), '| album meta:', await pg.text_content('.detail-meta'))
        await pg.click('.track >> nth=1'); await pg.wait_for_timeout(800)
        print('NP line:', await pg.evaluate("document.querySelector('.np-artist').textContent"))
        # Ratings: LB only (no MusicBrainz yet)
        n0=len(sent())
        await pg.evaluate("Rating.set('song','so1_2',5)"); await pg.wait_for_timeout(800)
        s1=sent()[n0:]
        print('5★, LB only:', [(x['path'], x['body']) for x in s1])
        # MusicBrainz sign-in: back from musicbrainz.org with ?code
        await pg.evaluate("localStorage.setItem('mare.mbauth', JSON.stringify({client:'cid',secret:'csec',state:'st1'}))")
        await pg.goto(B+'?code=abc&state=st1'); await pg.wait_for_timeout(1500)
        print('after sign-in:', await pg.evaluate("location.search+location.hash"), '| user:', await pg.evaluate("RateSync.mb().user"), '| token sent:', [x['body'] for x in sent() if x['path']=='/mbo/token'][-1:])
        await pg.goto(B+'#/settings'); await pg.wait_for_selector('.rate-sync')
        print('settings MB row:', (await pg.locator('.rate-sync ~ .set-row').nth(1).text_content()).strip()[:60])
        await pg.screenshot(path=f'{SP}/r7-settings.png', full_page=True)
        n0=len(sent())
        await pg.evaluate("Songs.get('so1_2') || register([{id:'so1_2',title:'x'}])")
        await pg.evaluate("(async()=>{ await albumSongs('al1'); await Rating.set('song','so1_2',3) })()"); await pg.wait_for_timeout(1200)
        print('5★ → 3★:', [(x['path'], x['body'][:140], x['auth'][:12]) for x in sent()[n0:]])
        n0=len(sent())
        await pg.click('[data-act="rate-sync-all"]'); await pg.wait_for_timeout(500)
        await pg.wait_for_function("!document.querySelector('[data-act=\"rate-sync-all\"]').disabled", timeout=60000)
        al=sent()[n0:]
        print('send all:', len([x for x in al if 'feedback' in x['path']]), 'loves |', len([x for x in al if x['path']=='/mb/rating']), 'MB requests |', await pg.text_content('#toast'))
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
