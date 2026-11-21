#!/usr/bin/env python3
"""Before/after screenshot comparison for the mv-first refactor (20261115-md §13).

For every PNG present in both dirs: writes a side-by-side image (before | after | diff mask)
into <out>, and prints the share of pixels that differ (any channel delta > 16).
Timestamps and "用时 Ns" labels legitimately differ between runs; layout regressions show up
as large areas in the diff mask.

usage: python3 tools/verify/compare-shots.py <before_dir> <after_dir> <out_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

before, after, out = (Path(p) for p in sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
rows = []
for b in sorted(before.glob('*.png')):
    a = after / b.name
    if not a.exists():
        continue
    ib, ia = Image.open(b).convert('RGB'), Image.open(a).convert('RGB')
    if ib.size != ia.size:
        rows.append({'shot': b.name, 'sameSize': False, 'before': ib.size, 'after': ia.size})
        continue
    nb, na = np.asarray(ib, dtype=np.int16), np.asarray(ia, dtype=np.int16)
    mask = (np.abs(nb - na).max(axis=2) > 16)
    ratio = float(mask.mean())
    diff = Image.fromarray(np.where(mask[..., None], np.array([230, 40, 40], np.uint8), (np.asarray(ib) * 0.25 + 190).astype(np.uint8)))
    w, h = ib.size
    canvas = Image.new('RGB', (w * 3 + 40, h + 44), 'white')
    for i, (img, label) in enumerate([(ib, 'before (dcb359db)'), (ia, 'after (mv-first)'), (diff, f'diff {ratio:.2%}')]):
        canvas.paste(img, (i * (w + 20), 44))
        ImageDraw.Draw(canvas).text((i * (w + 20) + 8, 14), label, fill='black')
    canvas.thumbnail((2400, 2400))
    canvas.save(out / f'compare-{b.name}')
    ys, xs = np.nonzero(mask)
    rows.append({'shot': b.name, 'sameSize': True, 'diffPixels': ratio,
                 'diffBox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())] if len(xs) else None})
print(json.dumps(rows, ensure_ascii=False, indent=1))
(out / 'compare.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1))
