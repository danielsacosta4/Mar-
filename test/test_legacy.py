# 1.6.1: the older-style copy for iOS 12 (iPhone 6). Forces it with localStorage mare.forceLegacy and walks the app.
import asyncio, sys, os
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        ctx=await br.new_context(viewport={'width':375,'height':667},has_touch=True,is_mobile=True)   # iPhone 6 size
        await ctx.add_init_script("try { localStorage.setItem('mare.forceLegacy','1') } catch (e) {}")
        pg=await ctx.new_page()
        pg.on('console', lambda m: m.type=='error' and 'Failed to load resource' not in m.text and errs.append(m.text))
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await pg.goto(B)
        files=await pg.evaluate("[...document.querySelectorAll('script[src],link[rel=stylesheet]')].map(e=>(e.src||e.href).replace(location.origin+'/','').split('?')[0])")
        print('legacy files:', files)
        await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
        await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
        await pg.screenshot(path=f'{SP}/legacy-home.png')
        await pg.goto(B+'#/album/al1'); await pg.wait_for_selector('.track')
        art=await pg.locator('.sleeve-front .art').bounding_box()
        print('album cover square: %dx%d' % (art['width'], art['height']))
        await pg.click('.track >> nth=0'); await pg.wait_for_timeout(1500)
        print('playing:', not await pg.evaluate("Player.audio.paused"), '| time moving:', await pg.evaluate("Player.pos()>0.3"))
        await pg.click('.player .p-title', force=True); await pg.wait_for_selector('.np .np-art'); await pg.wait_for_timeout(700)
        np=await pg.locator('.np .np-art').bounding_box(); scr=await pg.locator('.np').bounding_box()
        print('NP cover: %dx%d inside %dx%d screen' % (np['width'], np['height'], scr['width'], scr['height']))
        await pg.screenshot(path=f'{SP}/legacy-np.png')
        await pg.keyboard.press('Escape'); await pg.evaluate("UI.closeNP && UI.closeNP()")
        await pg.goto(B+'#/search?q=neon'); await pg.wait_for_selector('.top-result'); print('search ok:', await pg.locator('.top-result h3').text_content())
        await pg.goto(B+'#/settings'); await pg.wait_for_selector('[data-diag]'); print('settings ok')
        await pg.goto(B+'#/collection'); await pg.wait_for_timeout(1500); print('collection ok:', await pg.locator('h1').count()>0)
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
