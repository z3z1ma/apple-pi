"""PROTOTYPE (throwaway): turn raw-art/ into assets/ for the headquarters prototype.

Painted scenes load straight from raw-art/ (quantized to 256 colours). Sprite sheets on magenta are cut into pieces:
the door sheet into separate images, the cat sheet into one strip of equal frames with feet on one baseline.
Run from this directory: uv run -q -w pillow -w numpy python clean.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw-art", here / "assets"
out.mkdir(exist_ok=True)


def cut(path, count):
    sheet = np.array(Image.open(path).convert("RGB")).astype(int)
    r, g, b = sheet[..., 0], sheet[..., 1], sheet[..., 2]
    # Wide on purpose: generated edges blend into the magenta, and a narrow key leaves a purple fringe.
    magenta = (r > 140) & (b > 140) & (g < 0.62 * np.minimum(r, b)) & (np.abs(r - b) < 90)
    columns = (~magenta).sum(axis=0) > 3
    spans, start = [], None
    for x, filled in enumerate([*columns, False]):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            if x - start > 20:
                spans.append((start, x))
            start = None
    assert len(spans) == count, (path.name, spans)
    pieces = []
    for x0, x1 in spans:
        mask = ~magenta[:, x0:x1]
        rows = np.where(mask.sum(axis=1) > 3)[0]
        y0, y1 = rows[0], rows[-1] + 1
        rgba = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
        rgba[..., :3] = sheet[y0:y1, x0:x1]
        rgba[..., 3] = np.where(mask[y0:y1], 255, 0)
        pieces.append(Image.fromarray(rgba))
    return pieces


for name, piece in zip(["door-closed", "door-open", "door-boarded", "banner-cream", "banner-red"], cut(raw / "doors.png", 5)):
    piece.save(out / f"{name}.png")
    print(name, piece.size)

if (raw / "cat.png").exists():
    frames = cut(raw / "cat.png", 4)
    scale = 56 / max(f.height for f in frames)
    frames = [f.resize((round(f.width * scale), round(f.height * scale)), Image.Resampling.LANCZOS) for f in frames]
    cw, ch = max(f.width for f in frames) + 2, max(f.height for f in frames) + 2
    strip = Image.new("RGBA", (cw * 4, ch))
    for i, f in enumerate(frames):
        strip.paste(f, (i * cw + (cw - f.width) // 2, ch - 1 - f.height), f)
    strip.save(out / "cat.png")
    print("cat frame", cw, ch)
