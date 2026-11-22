"""Which browser the suites run in. MARE_BROWSER=chromium (default), firefox, or webkit (Safari's engine, for iPhone-like runs).
MARE_CHROMIUM can point at a Chromium binary; a preinstalled /opt/pw-browsers/chromium is picked up by itself."""
import os

NAME = os.environ.get('MARE_BROWSER', 'chromium')
WEBKIT = NAME == 'webkit'


def launch(p, **kw):
    if WEBKIT:
        kw.pop('args', None)          # Chromium-only switches
        # WebKit for Linux must NOT find a sound server: with PulseAudio's null sink its clock stops (songs "end" at 0 s).
        # Firefox is the opposite and needs one, so keep WebKit away from it instead of stopping it.
        env = dict(os.environ, PULSE_SERVER='unix:/nonexistent', PULSE_RUNTIME_PATH='/nonexistent')
        return p.webkit.launch(env=env, **kw)
    if NAME == 'firefox':
        kw.pop('args', None)
        return p.firefox.launch(firefox_user_prefs={'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0}, **kw)
    exe = os.environ.get('MARE_CHROMIUM') or ('/opt/pw-browsers/chromium' if os.path.isfile('/opt/pw-browsers/chromium') else None)
    if exe:
        kw['executable_path'] = exe
    return p.chromium.launch(**kw)


async def tap(ctx, pg, x, y):
    """A finger tap at a point (not a click): what the progress bar listens for on phones."""
    if NAME != 'chromium':
        await pg.touchscreen.tap(x, y)
        return
    c = await ctx.new_cdp_session(pg)
    await c.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    await pg.wait_for_timeout(80)
    await c.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


async def slow_cpu(ctx, pg, rate=4):
    """Slow the processor down like a phone. Chromium only; returns False where it can't."""
    if NAME != 'chromium':
        return False
    c = await ctx.new_cdp_session(pg)
    await c.send('Emulation.setCPUThrottlingRate', {'rate': rate})
    return True


def phone(p, width=390, height=844):
    """Context settings for a phone: on WebKit an iPhone profile (Safari's user agent, touch, screen), else a touch viewport."""
    if WEBKIT:
        d = dict(p.devices['iPhone 13'])
        d['viewport'] = {'width': width, 'height': height}
        return d
    return dict(viewport={'width': width, 'height': height}, has_touch=True, is_mobile=True)
