"""PROTOTYPE (throwaway): turn raw-art/ into assets/ for the headquarters prototype.

Painted scenes load straight from raw-art/ (quantized to 256 colours); the door sheet is cut into pieces on its magenta
background.
Run from this directory: uv run -q -w pillow -w numpy python clean.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw-art", here / "assets"
out.mkdir(exist_ok=True)

sheet = np.array(Image.open(raw / "doors.png").convert("RGB")).astype(int)
r, g, b = sheet[..., 0], sheet[..., 1], sheet[..., 2]
# Wide on purpose: generated edges blend into the magenta, and a narrow key leaves a purple fringe.
magenta = (r > 140) & (b > 140) & (g < 0.62 * np.minimum(r, b)) & (np.abs(r - b) < 90)
columns = (~magenta).sum(axis=0) > 3
pieces, start = [], None
for x, filled in enumerate(columns):
    if filled and start is None:
        start = x
    elif not filled and start is not None:
        if x - start > 40:
            pieces.append((start, x))
        start = None
names = ["door-closed", "door-open", "door-boarded", "banner-cream", "banner-red"]
assert len(pieces) == len(names), pieces
for name, (x0, x1) in zip(names, pieces):
    part = sheet[:, x0:x1]
    mask = ~magenta[:, x0:x1]
    rows = np.where(mask.sum(axis=1) > 3)[0]
    y0, y1 = rows[0], rows[-1] + 1
    rgba = np.zeros((y1 - y0, x1 - x0, 4), dtype=np.uint8)
    rgba[..., :3] = part[y0:y1]
    rgba[..., 3] = np.where(mask[y0:y1], 255, 0)
    Image.fromarray(rgba).save(out / f"{name}.png")
    print(name, rgba.shape[1], rgba.shape[0])
