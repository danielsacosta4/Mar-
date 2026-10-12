import asyncio, sys, os
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
# Round 4: library catalog (quality labels, spec sheet, Collection page) and star ratings.
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        async def run(name,w,h,scheme):
            ctx=await br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme)
            pg=await ctx.new_page()
            pg.on('console', lambda m: m.type=='error' and errs.append(f'{name}: {m.text}'))
            pg.on('pageerror', lambda e: errs.append(f'{name} PAGEERR: {e}'))
            await pg.goto(B)
            await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.sheet', timeout=5000); await pg.click('[data-close]')
            await pg.wait_for_selector('.shelf .card', timeout=8000)
            await pg.wait_for_function('window.Catalog && Catalog.load()', timeout=15000); await pg.wait_for_timeout(300)
            print(name,'catalog: songs', await pg.evaluate('Catalog.load().songs'), 'albums', await pg.evaluate('Object.keys(Catalog.load().albums).length'))
            print(name,'card labels:', await pg.evaluate("[...document.querySelectorAll('.shelf .card .qtags')].slice(0,4).map(e=>e.textContent)"))
            print(name,'top rated row:', await pg.locator('.section:has-text("Top Rated") .card').count())
            # Collection page and a filter
            await pg.goto(B+'#/collection'); await pg.wait_for_selector('.tile'); await pg.wait_for_timeout(300)
            print(name,'tiles:', await pg.evaluate("[...document.querySelectorAll('.tile b')].map(e=>e.textContent)"),
                  'bars:', await pg.evaluate("[...document.querySelectorAll('.res-n')].map(e=>e.textContent)"))
            await pg.screenshot(path=f'{SP}/r4-{name}-collection.png')
            await pg.click('.tile >> nth=2'); await pg.wait_for_timeout(500)
            print(name,'lossy filter:', await pg.evaluate('location.hash'), await pg.evaluate("[...document.querySelectorAll('.grid .card-title')].map(e=>e.textContent)"))
            # Spec sheet
            await pg.goto(B+'#/album/al5'); await pg.wait_for_selector('.spec'); await pg.wait_for_timeout(300)
            print(name,'spec (lossy album):', await pg.evaluate("[...document.querySelectorAll('.spec dl div')].map(d=>d.children[0].textContent+'='+d.children[1].textContent).join(' | ')"))
            await pg.goto(B+'#/album/al7'); await pg.wait_for_selector('.spec'); await pg.wait_for_timeout(300)
            print(name,'spec (untagged hi-res):', await pg.evaluate("[...document.querySelectorAll('.spec dl div')].map(d=>d.children[0].textContent+'='+d.children[1].textContent).join(' | ')"))
            await pg.screenshot(path=f'{SP}/r4-{name}-album.png')
            # Album rating: set 2, then tap 2 again to clear
            await pg.click('.album-rate .star >> nth=1'); await pg.wait_for_timeout(500)
            r1=await pg.evaluate("API.call('getAlbum',{id:'al7'}).then(r=>r.album.userRating||0)")
            await pg.click('.album-rate .star >> nth=1'); await pg.wait_for_timeout(500)
            r2=await pg.evaluate("API.call('getAlbum',{id:'al7'}).then(r=>r.album.userRating||0)")
            print(name,'album rating set/clear:', r1, r2)
            # Song rating from the menu, then by keyboard while playing
            await pg.locator('.t-more >> nth=2').scroll_into_view_if_needed(); await pg.wait_for_timeout(600)
            sid=await pg.evaluate("document.querySelectorAll('.track')[2].dataset.song")
            before=await pg.evaluate(f"API.call('getSong',{{id:'{sid}'}}).then(r=>r.song.userRating||0)")
            k=2 if before==4 else 3   # tapping the current rating would clear it, so pick another
            await pg.click('.t-more >> nth=2', force=True); await pg.click(f'.menu-stars .star >> nth={k}'); await pg.wait_for_timeout(500)
            print(name,f'menu rating (want {k+1}):', await pg.evaluate(f"API.call('getSong',{{id:'{sid}'}}).then(r=>r.song.userRating||0)"),
                  'row shows:', await pg.locator('.track >> nth=2').locator('.t-rating').text_content())
            await pg.click('.track >> nth=0'); await pg.wait_for_timeout(800)
            await pg.keyboard.press('5'); await pg.wait_for_timeout(500)
            cur=await pg.evaluate('Player.current().id')
            print(name,'key 5 on current:', await pg.evaluate(f"API.call('getSong',{{id:'{cur}'}}).then(r=>r.song.userRating||0)"))
            await pg.click('.p-now'); await pg.wait_for_timeout(800)
            print(name,'NP stars on:', await pg.locator('.np-rate .star.on').count())
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(400)
            await pg.keyboard.press('0'); await pg.wait_for_timeout(500)
            print(name,'key 0 clears:', await pg.evaluate(f"API.call('getSong',{{id:'{cur}'}}).then(r=>r.song.userRating||0)"))
            # 5-star mix and the Top Rated sort
            await pg.goto(B+'#/collection'); await pg.wait_for_selector('[data-act="mix-top"]')
            await pg.click('[data-act="mix-top"]'); await pg.wait_for_timeout(800)
            print(name,'5-star mix:', await pg.evaluate('Player.queue.length'), 'all rated 4+:', await pg.evaluate('Player.queue.every(s=>s.userRating>=4)'))
            await pg.goto(B+'#/albums?sort=highest'); await pg.wait_for_selector('.grid .card'); await pg.wait_for_timeout(300)
            print(name,'top rated sort first:', await pg.text_content('.grid .card-title'))
            if w > 760:
                # 1.4.1: the player bar (stars, quality picker that applies to the playing song) and right-click menus
                await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=2'); await pg.wait_for_timeout(1500)
                print(name,'bar label:', await pg.text_content('.p-quality'), '| bar stars:', await pg.locator('.p-rate .star').count(),
                      '| volume width:', await pg.evaluate("Math.round(document.querySelector('.p-right .volume').getBoundingClientRect().width)"))
                t0=await pg.evaluate('Player.pos()')
                await pg.click('.p-quality'); await pg.click('[data-mi=q-normal]'); await pg.wait_for_timeout(700)
                print(name,'switch to 192 mid-song: still playing', not await pg.evaluate('Player.audio.paused'), '| kept position', await pg.evaluate('Player.pos()') >= t0 - 0.5,
                      '| src', await pg.evaluate("/format=mp3&maxBitRate=192/.test(Player.audio.src) && /timeOffset=/.test(Player.audio.src)"), '| label:', await pg.text_content('.p-quality'))
                await pg.click('.p-quality'); await pg.click('[data-mi=q-opus128]'); await pg.wait_for_timeout(600)
                print(name,'opus 128:', await pg.evaluate("/format=opus&maxBitRate=128/.test(Player.audio.src)"), '| label:', await pg.text_content('.p-quality'))
                await pg.click('.p-quality'); await pg.click('[data-mi=q-original]'); await pg.wait_for_timeout(500)
                print(name,'back to original:', await pg.evaluate("!/format=/.test(Player.audio.src)"), await pg.evaluate("Prefs.get('quality')"))
                await pg.click('.p-rate .star >> nth=1'); await pg.wait_for_timeout(500)
                print(name,'rated from bar:', await pg.evaluate('Player.current().userRating'))
                await pg.click('.track >> nth=4', button='right'); await pg.wait_for_timeout(300)
                print(name,'right-click song:', await pg.locator('#menu .menu-stars').count(), await pg.locator('#menu [data-mi=next]').count())
                await pg.keyboard.press('Escape')
                await pg.goto(B+'#/albums'); await pg.wait_for_selector('.grid .card'); await pg.click('.grid .card >> nth=1', button='right'); await pg.wait_for_timeout(300)
                print(name,'right-click album:', await pg.evaluate("[...document.querySelectorAll('#menu [data-mi]')].map(b=>b.dataset.mi).join(',')"), '| stayed on page:', await pg.evaluate('location.hash'))
            await ctx.close()
        # A device that can't play Opus (iPhones before iOS 17) gets a comparable MP3 instead.
        ctx=await br.new_context(viewport={'width':1400,'height':880})
        await ctx.add_init_script("const o=HTMLMediaElement.prototype.canPlayType;HTMLMediaElement.prototype.canPlayType=function(t){return /opus/.test(t)?'':o.call(this,t)}")
        pg=await ctx.new_page(); await pg.goto(B)
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.evaluate("Prefs.set('quality','opus128')"); await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track'); await pg.click('.track >> nth=0'); await pg.wait_for_timeout(800)
        print('no-opus device: CAN_OPUS', await pg.evaluate('CAN_OPUS'), '| src mp3 320:', await pg.evaluate("/format=mp3&maxBitRate=320/.test(Player.audio.src)"), '| label:', await pg.text_content('.p-quality'))
        await pg.evaluate("Prefs.set('quality','original')"); await ctx.close()
        await run('desk',1400,880,'light')
        await run('mob',390,844,'dark')
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
