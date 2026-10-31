"""Finishes the iOS 12 copy of the stylesheet (app/legacy/app.css) after esbuild has lowered what it can.
Old Safari drops a whole declaration it doesn't understand, so each newer feature gets a plain stand-in here."""
import re, sys
p = sys.argv[1]
css = open(p).read()
css = css.replace('url(fonts/', 'url(../fonts/')                       # the stylesheet now lives one folder down
# clamp(a, b, c) is max(a, min(b, c)); min() and max() work on iOS 12.
css = re.sub(r'clamp\(([^,()]+),([^,()]+),([^,()]+)\)', lambda m: f'max({m[1].strip()}, min({m[2].strip()}, {m[3].strip()}))', css)
css += """
/* ---- iOS 12 stand-ins (added by build/legacy.py) ---- */
/* Now Playing fills the screen (its inset uses a variable, which esbuild leaves as is). */
.np { top: 0; right: 0; left: 0; bottom: calc(-1 * var(--ios-gap, 0px)); }
/* Square covers without aspect-ratio. */
.art { height: 0; padding-bottom: 100%; }
.art > img { position: absolute; top: 0; left: 0; }
.mfy-card { min-height: 200px; }
/* Now Playing cover: no container units or translate property there. */
.np-art { width: min(70vw, 34vh); height: min(70vw, 34vh); transform: translate(-7px, -7px); }
.np.is-paused .np-art { transform: translate(-7px, -7px) scale(.9); }
@media (min-width: 1001px) { .np-art { width: min(38vw, 56vh); height: min(38vw, 56vh); } }
/* The player strip's softer colours were mixed with color-mix(). */
.player { --ink-2: rgba(235, 233, 228, .62); --line: rgba(235, 233, 228, .22); }
"""
open(p, 'w').write(css)
