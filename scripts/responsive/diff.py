#!/usr/bin/env python3
"""Compare two responsive-capture runs: every PNG present in both, pixel by pixel.

    python3 diff.py <before-dir> <after-dir> <out-dir> [--threshold 0]

Writes <out-dir>/report.tsv (file, changed px, % of the larger image, size before/after, bbox) and,
for every changed image, <out-dir>/<theme>/<name>.png = before | after | difference (red) side by side.
"""
import os
import sys
from PIL import Image, ImageChops

before, after, out = sys.argv[1], sys.argv[2], sys.argv[3]
rows = []
for theme in sorted(os.listdir(before)):
    bdir = os.path.join(before, theme)
    if not os.path.isdir(bdir):
        continue
    for name in sorted(os.listdir(bdir)):
        if not name.endswith(".png"):
            continue
        a_path = os.path.join(after, theme, name)
        if not os.path.exists(a_path):
            rows.append((f"{theme}/{name}", "MISSING-AFTER", "", "", "", ""))
            continue
        a = Image.open(os.path.join(bdir, name)).convert("RGB")
        b = Image.open(a_path).convert("RGB")
        w, h = max(a.width, b.width), max(a.height, b.height)
        pa = Image.new("RGB", (w, h), (255, 0, 255)); pa.paste(a, (0, 0))
        pb = Image.new("RGB", (w, h), (255, 0, 255)); pb.paste(b, (0, 0))
        d = ImageChops.difference(pa, pb).convert("L").point(lambda v: 255 if v > 8 else 0)
        bbox = d.getbbox()
        changed = sum(1 for v in d.getdata() if v) if bbox else 0
        rows.append((f"{theme}/{name}", str(changed), f"{100.0 * changed / (w * h):.2f}", f"{a.width}x{a.height}", f"{b.width}x{b.height}", str(bbox or "")))
        if bbox:
            os.makedirs(os.path.join(out, theme), exist_ok=True)
            red = Image.new("RGB", (w, h), (20, 20, 20)); red.paste((255, 0, 0), mask=d)
            sheet = Image.new("RGB", (w * 3 + 40, h), (255, 0, 255))
            sheet.paste(pa, (0, 0)); sheet.paste(pb, (w + 20, 0)); sheet.paste(red, (2 * w + 40, 0))
            sheet.save(os.path.join(out, theme, name))
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "report.tsv"), "w") as f:
    f.write("file\tchanged_px\tpct\tbefore\tafter\tbbox\n")
    for r in rows:
        f.write("\t".join(r) + "\n")
same = sum(1 for r in rows if r[1] == "0")
print(f"{len(rows)} compared, {same} identical, {len(rows) - same} changed")
for r in rows:
    if r[1] != "0":
        print("\t".join(r))
