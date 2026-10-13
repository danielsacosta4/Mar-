import asyncio, sys, os
from playwright.async_api import async_playwright
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
# Round 6: Moments (Right Now on Home + the Moments page). The mock has noon listens every day and evening listens for 90 days.
async def main():
    async with async_playwright() as p:
        br=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        errs=[]
        async def run(name,w,h,scheme):
            ctx=await br.new_context(viewport={'width':w,'height':h}, color_scheme=scheme)
            pg=await ctx.new_page()
            pg.on('console', lambda m: m.type=='error' and 'TUNNEL' not in m.text and errs.append(f'{name}: {m.text}'))
            pg.on('pageerror', lambda e: errs.append(f'{name} PAGEERR: {e}'))
            await pg.goto(B)
            await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
            await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
            # Pretend it is Friday 20:30 (a weekday evening).
            await pg.evaluate("localStorage.setItem('mare.lb', JSON.stringify({user:'modren12',token:'good'})); localStorage.removeItem('mare.moments'); Moments.now = () => new Date(2026, 9, 16, 20, 30)")
            await pg.goto(B+'#/albums'); await pg.wait_for_selector('.grid .card'); await pg.goto(B+'#/')
            await pg.wait_for_selector('.moments-now .card', timeout=20000); await pg.wait_for_timeout(300)
            print(name,'Right Now:', await pg.text_content('.moments-now .section-note'), '| albums:', await pg.locator('.moments-now .card').count(),
                  '| above On This Day:', await pg.evaluate("(()=>{const a=document.querySelector('.moments-now'),b=document.querySelector('.on-this-day');return !b||!!(a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING)})()"))
            await pg.screenshot(path=f'{SP}/r6-{name}-home.png')
            # A noon moment on a weekday still works, and a night-time one (no plays) shows nothing.
            await pg.evaluate("Moments.now = () => new Date(2026, 9, 16, 3, 0)")
            await pg.goto(B+'#/albums'); await pg.wait_for_selector('.grid .card'); await pg.goto(B+'#/'); await pg.wait_for_selector('.shelf .card'); await pg.wait_for_timeout(1500)
            print(name,'night (no history) shows row:', await pg.locator('.moments-now').count())
            await pg.evaluate("Moments.now = () => new Date(2026, 9, 16, 20, 30)")
            # The page
            await pg.goto(B+'#/moments'); await pg.wait_for_selector('.moment .card', timeout=20000); await pg.wait_for_timeout(1500)
            print(name,'page sections:', await pg.evaluate("[...document.querySelectorAll('.moment h2')].map(e=>e.textContent)"),
                  '| thin note:', await pg.evaluate("(document.querySelector('.mo-thin')||{}).textContent"))
            await pg.screenshot(path=f'{SP}/r6-{name}-moments.png', full_page=True)
            await pg.click('.moment >> nth=0 >> [data-act=play-moment]'); await pg.wait_for_timeout(1500)
            print(name,'play this moment: queue', await pg.evaluate('Player.queue.length'), '| playing', not await pg.evaluate('Player.audio.paused'))
            await pg.goto(B+'#/library'); await pg.wait_for_selector('.lib-links'); await pg.wait_for_timeout(300)
            print(name,'library link:', await pg.locator('.lib-links [href="#/moments"]').count(), '| sidebar link:', await pg.locator('.side-nav [data-nav=moments]').count())
            await ctx.close()
        await run('desk',1400,880,'light')
        await run('mob',390,844,'dark')
        print('ERRORS:', errs or 'none')
        await br.close()
asyncio.run(main())
