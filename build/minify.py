#!/usr/bin/env python3
"""Light, safe minifier for Maré's own files: drops comments and indentation only."""
import re, sys, pathlib
src, dst = map(pathlib.Path, sys.argv[1:3])
dst.mkdir(parents=True, exist_ok=True)
for f in src.iterdir():
    if not f.is_file(): continue
    out = dst / f.name
    if f.suffix == '.js':
        lines = []
        for ln in f.read_text().splitlines():
            s = ln.strip()
            if not s or s.startswith('//') or (s.startswith('/*') and s.endswith('*/')): continue
            lines.append(s)
        out.write_text('\n'.join(lines) + '\n')
    elif f.suffix == '.css':
        t = re.sub(r'/\*.*?\*/', '', f.read_text(), flags=re.S)
        t = re.sub(r'\s*\n\s*', '\n', t)
        t = re.sub(r'\n+', '\n', t)
        out.write_text(t.strip() + '\n')
    else:
        out.write_bytes(f.read_bytes())
