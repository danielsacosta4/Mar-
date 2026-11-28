# 1.8.4: two measurements. (1) The hi-res sample check in Settings: the mock serves real FLAC files of a known kind
# (/__hires?1: a true 24/96 recording, CD sound stretched to 96 kHz, 16-bit padded to 24-bit, 96 kHz stretched to
# 192 kHz) and the tool must name each correctly. (2) The globe counts for how many artists MusicBrainz knows a town.
import asyncio, sys, os, json, shutil
from urllib.request import urlopen
from playwright.async_api import async_playwright
from browser import launch, phone, NAME
SP=sys.argv[1] if len(sys.argv)>1 else 'test-output'; os.makedirs(SP, exist_ok=True); B=os.environ.get('MARE_URL','http://127.0.0.1:8765/')
get=lambda path: json.loads(urlopen(B+path).read())
async def login(pg):
    await pg.goto(B); await pg.fill('input[name=user]','demo'); await pg.fill('input[name=pass]','secret'); await pg.click('button[type=submit]')
    await pg.wait_for_selector('.sheet'); await pg.click('[data-close]'); await pg.wait_for_selector('.shelf .card')
async def main():
    if not shutil.which('ffmpeg'): print('SKIPPED: needs ffmpeg to make the test recordings'); return
    kinds=get('__hires?1')['kinds']; problems=[]
    def check(label, ok, extra=''):
        print(('  ok      ' if ok else '  PROBLEM ')+label+(f'  {extra}' if extra else ''))
        if not ok: problems.append(label)
    async with async_playwright() as p:
        br=await launch(p); errs=[]
        ctx=await br.new_context(viewport={'width':1300,'height':900}); pg=await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg); await pg.evaluate("MB.gap=30")
        print('== the hi-res sample check')
        await pg.goto(B+'#/collection'); await pg.wait_for_selector('.tile'); await pg.wait_for_function("!!Catalog.load()", timeout=30000)
        await pg.goto(B+'#/settings'); await pg.wait_for_selector('[data-act="hi-check"]')
        check('nothing is loaded before the button is pressed', not await pg.evaluate("!!window.HiCheck"))
        before=len([x for x in get('__log') if ' raw' in x])
        await pg.click('[data-act="hi-check"]'); await pg.wait_for_selector('.hc-foot', timeout=120000)
        print('  this browser:', await pg.evaluate("({reads96: HiCheck.reads96, keeps24: HiCheck.keeps24})"))
        rows=await pg.evaluate("HiCheck.rows.map(x=>({id:x.id, album:x.album, says:x.says, verdict:x.r.verdict, from:x.r.from||'', cliff:x.r.cliff||0, padded:x.r.padded, rate:x.r.rate, bits:x.r.bits, error:x.r.error||''}))")
        for r in sorted(rows, key=lambda x: x['id']): print('   ', r)
        got={r['id']: r['verdict'] for r in rows}
        check('it picked the five albums labelled hi-res, and no lossy or CD one', sorted(got)==sorted(kinds), str(sorted(got)))
        check('each is named for what it is', got==kinds, f'expected {kinds}')
        by={r['id']: r for r in rows}
        check('CD sound in a 96 kHz file: the edge is found near 21 kHz', by.get('al3',{}).get('from')=='cd' and 20000<=by['al3']['cliff']<=23000, str(by.get('al3',{}).get('cliff')))
        check('96 kHz sound in a 192 kHz file: read at 192 kHz, edge near 48 kHz', by.get('al9',{}).get('rate')==192000 and by['al9']['from']=='double' and 45000<=by['al9']['cliff']<=50000, str(by.get('al9',{}).get('cliff')))
        check('the padded one keeps its sound to the top; only its bits are empty', by.get('al7',{}).get('padded') is True and not by['al7']['cliff'])
        summ=await pg.text_content('.hc-note b')
        check('summary line', summ.strip()=='Of 5 albums: 2 native, 2 upsampled, 1 padded.', summ)
        words=await pg.eval_on_selector_all('.hc-row', "e=>e.map(x=>x.querySelector('.hc-name b').textContent+' = '+x.querySelector('.hc-v').textContent)")
        check('the table shows them', len(words)==5 and sum('Upsampled' in w for w in words)==2 and sum('Native' in w for w in words)==2 and sum('Padded' in w for w in words)==1, str(words))
        text=await pg.evaluate("HiCheck.text()")
        check('the result can be copied as text', text.count('\n')==6 and 'ends at' in text and 'low bits empty' in text, text.split('\n')[1])
        await pg.screenshot(path=f'{SP}/r11-hicheck.png', full_page=False)
        await pg.evaluate("document.querySelector('#hicheck').scrollIntoView()"); await pg.screenshot(path=f'{SP}/r11-hicheck-table.png')
        streams=[x for x in get('__log') if ' raw' in x][before:]
        check('one song per album was read, as the original file', len(streams)==5, str(streams[:5]))

        print('== towns for the globe')
        await pg.wait_for_function("!Geo.running", timeout=60000)   # the first Collection visit started the lookups
        await pg.evaluate("MB.gap=30; localStorage.removeItem('mare.geo'); Geo.d=null")
        await pg.goto(B+'#/collection'); await pg.wait_for_selector('.atlas-places:not([hidden])', timeout=60000)
        await pg.wait_for_function("!Geo.running && /4 placed/.test(document.querySelector('.atlas-places').textContent)", timeout=60000)
        line=await pg.text_content('.atlas-places')
        check('fresh lookups: town for 2 of 4, region for 1', line.strip()=='MusicBrainz knows the town for 2 of 4 placed artists, and only the region for 1 more.', line)
        check('the places are remembered', await pg.evaluate("JSON.stringify(Geo.data().p)")==json.dumps({"ar1":["c","Lisboa","area-lx"],"ar2":0,"ar3":["r","Algarve","area-alg"],"ar4":["c","Chicago","area-city"]},separators=(',',':'),ensure_ascii=False), await pg.evaluate("JSON.stringify(Geo.data().p)"))
        # A browser that looked everyone up before 1.8.4 (countries known, no towns): only the towns are asked for.
        await pg.evaluate("localStorage.setItem('mare.geo', JSON.stringify({v:1,a:{ar1:'PT',ar2:'NO',ar3:'PT',ar4:'US',ar5:'-'},areas:{}})); Geo.d=null; MB.gap=30")
        await pg.goto(B+'#/home'); await pg.goto(B+'#/collection'); await pg.wait_for_selector('.atlas-places:not([hidden])', timeout=60000)
        await pg.wait_for_function("!Geo.running && !/Still asking/.test(document.querySelector('.atlas-places').textContent)", timeout=60000)
        line=await pg.text_content('.atlas-places'); g=await pg.evaluate("Geo.data()")
        check('after an update from 1.8.3: same count, countries untouched', line.strip()=='MusicBrainz knows the town for 2 of 4 placed artists, and only the region for 1 more.' and g['a']=={"ar1":"PT","ar2":"NO","ar3":"PT","ar4":"US","ar5":"-"}, line)
        await pg.screenshot(path=f'{SP}/r11-places.png')
        await ctx.close()

        ctx=await br.new_context(**phone(p, 390, 844))
        await ctx.add_init_script("Object.defineProperty(HTMLMediaElement.prototype,'volume',{configurable:true,get(){return 1},set(){}});")
        pg=await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(f'PAGEERR: {e}'))
        await login(pg); await pg.goto(B+'#/settings'); await pg.wait_for_selector('[data-act="scan-library"]')
        check('iPhone: the check is not offered (it would download hundreds of MB)', await pg.locator('[data-act="hi-check"]').count()==0)
        await ctx.close()
        if errs: problems.append('page errors: '+'; '.join(errs[:3]))
        print('RESULT:', 'OK' if not problems else 'PROBLEMS: '+' | '.join(problems))
        await br.close()
    get('__hires?0')
asyncio.run(main())
