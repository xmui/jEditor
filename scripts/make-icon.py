#!/usr/bin/env python3
# Makes src/jEditor.ico (the exe's and the installer's icon) from
# app/icon.png. Run again if the icon changes:  python3 scripts/make-icon.py
# Needs Pillow (pip install pillow).
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'app' / 'icon.png').convert('RGBA')
out = root / 'src' / 'jEditor.ico'
src.save(out, format='ICO', sizes=[(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f'Wrote {out.relative_to(root)} ({out.stat().st_size // 1024} KB)')
