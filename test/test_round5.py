import asyncio, sys, os
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
# Round 5: the shopping list (new releases, discographies via MusicBrainz, missing albums) and the time machine.
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        async def run(name,w,h,scheme):
            ctx=await br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme)
            pg=await ctx.new_page()
            pg.on('console', lambda m: m.type=='error' and 'ERR_TUNNEL' not in m.text and 'ERR_NAME' not in m.text and errs.append(f'{name}: {m.text}'))   # cover art is external
            pg.on('pageerror', lambda e: errs.append(f'{name} PAGEERR: {e}'))
            await pg.goto(B)
            await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.sheet', timeout=5000); await pg.click('[data-close]')
            # Without ListenBrainz: the pages explain what they need; discographies still work.
            await pg.goto(B+'#/new'); await pg.wait_for_timeout(500)
            print(name,'new without LB:', await pg.text_content('.empty h3'))
            await pg.evaluate("localStorage.setItem('mare.lb', JSON.stringify({user:'modren12',token:'good'})); localStorage.removeItem('mare.hidden')")
            await pg.goto(B); await pg.reload()
            await pg.wait_for_selector('.on-this-day', timeout=30000); await pg.wait_for_timeout(1000)
            print(name,'home rows:', await pg.evaluate("[...document.querySelectorAll('#home-discover .section-head h2')].map(e=>e.textContent).slice(0,3)"))
            print(name,'on this day:', await pg.text_content('.on-this-day .section-note'), '| albums', await pg.locator('.on-this-day .card').count())
            await pg.click('[data-act="play-day"]'); await pg.wait_for_timeout(1500)
            print(name,'play that day:', await pg.evaluate('Player.queue.length'), await pg.evaluate('Player.current() && Player.current().album'))
            # Artist discography: owned vs missing (live albums and future releases left out; "(Deluxe Edition)" still owned)
            await pg.goto(B+'#/artist/ar3'); await pg.wait_for_selector('#artist-disco .section', timeout=20000)
            print(name,'discography:', await pg.text_content('.disco-count'), await pg.locator('#artist-disco .card-title').all_text_contents())
            # New releases
            await pg.goto(B+'#/new'); await pg.wait_for_selector('#new-list .section', timeout=20000)
            print(name,'new releases:', await pg.locator('#new-list .section-head h2').all_text_contents(), 'cards', await pg.locator('#new-list .card').count(), 'owned', await pg.locator('#new-list .card:not(.missing-card)').count())
            await pg.goto(B+'#/new?show=missing'); await pg.wait_for_selector('#new-list .section', timeout=20000)
            print(name,'new, missing only:', await pg.locator('#new-list .card').count())
            # Shopping list + hide
            await pg.goto(B+'#/shopping'); await pg.wait_for_function("document.querySelector('#shop-progress') && !/Checking/.test(document.querySelector('#shop-progress').textContent)", timeout=60000)
            print(name,'shopping:', await pg.text_content('#shop-progress'))
            before=await pg.locator('.missing-card').count()
            await pg.click('.shop-artist [data-act="not-interested"] >> nth=0'); await pg.wait_for_timeout(300)
            print(name,'hide removes a card:', before-1==await pg.locator('.missing-card').count(), '| stored', len(await pg.evaluate("JSON.parse(localStorage.getItem('mare.hidden')||'[]')")))
            await pg.screenshot(path=f'{SP}/r5-{name}-shopping.png')
            # Year in review
            await pg.goto(B+'#/year/2025'); await pg.wait_for_selector('#year-body .front', timeout=60000); await pg.wait_for_timeout(500)
            print(name,'year:', await pg.text_content('#year-when'), '| strip', await pg.locator('.feature-strip div').all_text_contents())
            print(name,'year sections:', await pg.locator('#year-body .section-head h2').all_text_contents(), '| new artists', await pg.locator('.section:has-text("New to You") .chip').all_text_contents())
            await pg.screenshot(path=f'{SP}/r5-{name}-year.png')
            await pg.click('#year-body [data-act="play-list"]'); await pg.wait_for_timeout(800)
            print(name,'play your year:', await pg.evaluate('Player.queue.length'))
            await pg.goto(B+'#/year/2024'); await pg.wait_for_selector('#year-body .front', timeout=60000)
            print(name,'2024 (first year, no "new to you"):', await pg.locator('.feature-strip div').all_text_contents())
            await ctx.close()
        await run('desk',1400,880,'light')
        await run('mob',390,844,'dark')
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
