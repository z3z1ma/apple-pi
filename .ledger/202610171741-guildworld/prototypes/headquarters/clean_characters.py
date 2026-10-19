"""PROTOTYPE (throwaway): cut raw-art/chars/ sheets into uniform sprite strips and portrait sets in assets/chars/.

A sheet is 4 rows x 4 frames on magenta (walk down, walk up, walk left, then sit-back A, sit-back B, stand, ask).
Frames are cut by their magenta gaps, trimmed, scaled so a standing character is HEIGHT px tall, and placed with
their feet on one baseline in equal cells, so they do not jitter. Portraits are four busts in a 2 x 2 grid.
Writes assets/chars/<name>.png (16 cells in one row), <name>-portrait-<0..3>.png, and manifest.json.
Run from this directory: uv run -q -w pillow -w numpy python clean_characters.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw-art" / "chars", here / "assets" / "chars"
out.mkdir(parents=True, exist_ok=True)
HEIGHT = 120  # standing height in sprite pixels
PORTRAIT_HEIGHT = 360


def magenta_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Wide on purpose: generated edges blend into the magenta, and a narrow key leaves a purple fringe.
    return (r > 140) & (b > 140) & (g < 0.62 * np.minimum(r, b)) & (np.abs(r - b) < 90)


def bands(filled, min_gap, min_size):
    out, start, gap = [], None, 0
    for i, f in enumerate(filled):
        if f:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                if i - gap + 1 - start >= min_size:
                    out.append((start, i - gap + 1))
                start, gap = None, 0
    if start is not None and len(filled) - start >= min_size:
        out.append((start, len(filled)))
    return out


def pieces(path, rows, cols):
    rgb = np.array(Image.open(path).convert("RGB")).astype(int)
    keep = ~magenta_mask(rgb)
    found = []
    row_bands = bands(keep.sum(axis=1) > 2, 6, 30)
    if len(row_bands) != rows:
        raise SystemExit(f"{path.name}: expected {rows} rows, found {len(row_bands)}")
    for y0, y1 in row_bands:
        col_bands = bands(keep[y0:y1].sum(axis=0) > 2, 6, 20)
        if len(col_bands) != cols:
            raise SystemExit(f"{path.name}: expected {cols} pieces in a row, found {len(col_bands)}")
        for x0, x1 in col_bands:
            m = keep[y0:y1, x0:x1]
            ys, xs = np.where(m)
            yy0, yy1, xx0, xx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            rgba = np.zeros((yy1 - yy0, xx1 - xx0, 4), dtype=np.uint8)
            rgba[..., :3] = rgb[y0 + yy0 : y0 + yy1, x0 + xx0 : x0 + xx1]
            rgba[..., 3] = np.where(m[yy0:yy1, xx0:xx1], 255, 0)
            found.append(Image.fromarray(rgba))
    return found


manifest = {}
for sheet in sorted(raw.glob("*-sheet.png")):
    name = sheet.name.removesuffix("-sheet.png")
    frames = pieces(sheet, 4, 4)
    standing = np.median([f.height for f in frames[:12]])
    scale = HEIGHT / standing
    frames = [f.resize((max(1, round(f.width * scale)), max(1, round(f.height * scale))), Image.Resampling.LANCZOS) for f in frames]
    cw = max(f.width for f in frames) + 4
    ch = max(f.height for f in frames) + 4
    strip = Image.new("RGBA", (cw * len(frames), ch))
    for i, f in enumerate(frames):
        strip.paste(f, (i * cw + (cw - f.width) // 2, ch - 2 - f.height), f)
    # Hard alpha after resampling, so edges stay crisp against the painted rooms.
    a = np.array(strip)
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    Image.fromarray(a).save(out / f"{name}.png")
    entry = {"frame": [cw, ch]}
    portrait = raw / f"{name}-portrait.png"
    if portrait.exists():
        busts = pieces(portrait, 2, 2)
        for i, b in enumerate(busts):
            s = PORTRAIT_HEIGHT / b.height
            b.resize((round(b.width * s), PORTRAIT_HEIGHT), Image.Resampling.LANCZOS).quantize(256, method=Image.Quantize.FASTOCTREE).save(
                out / f"{name}-portrait-{i}.png", optimize=True
            )
        entry["portraits"] = len(busts)
    manifest[name] = entry
    print(name, entry)

(out / "manifest.json").write_text(json.dumps(manifest, indent=2))
