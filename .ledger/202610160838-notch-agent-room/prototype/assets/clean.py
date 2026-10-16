"""PROTOTYPE: turn raw generated images into crisp pixel assets for web/assets.

raw/<vibe>/room-<name>.png  -> web/assets/<vibe>/room-<name>.png (the room's interior, 208×116 art pixels)
raw/<vibe>/worker-<name>.png -> web/assets/<vibe>/<name>-<state>-<variant>.png (2×2 sheet of poses, magenta background)
and web/assets/manifest.js, which tells the page which vibes, rooms, and workers exist.

Run: uv run -q -w pillow -w numpy python assets/clean.py
"""

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

here = Path(__file__).resolve().parent
raw, out = here / "raw", here.parent / "web" / "assets"

ROOM_SIZE = (208, 116)  # about 5.5 raw pixels per art pixel once a 1376×768 generation is cropped to its interior
AGENT_PIXEL = 10  # agents drawn at half their generated detail so several fit in one room
COLORS = 48
STATES = ["working", "quiet", "waiting", "done"]  # sheet order: left to right, top to bottom
SHIRT_HUES = [None, 0, 120, 280, 330, 170]  # None keeps the generated blue; others are target hues in degrees


def quantize(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    rgb = image.convert("RGB").quantize(COLORS, method=Image.Quantize.MEDIANCUT).convert("RGBA")
    rgb.putalpha(alpha)
    return rgb


def recolor(frame: Image.Image, hue: int | None) -> Image.Image:
    """Move the shirt's blue pixels to another hue; dark hair and grey laptops stay put."""
    if hue is None:
        return frame
    hsv = np.asarray(frame.convert("RGB").convert("HSV")).copy()
    h, s, v = (hsv[..., i].astype(int) for i in range(3))
    blue = (h > 135) & (h < 175) & (s > 90) & (v > 90)
    hsv[..., 0] = np.where(blue, round(hue / 360 * 255), h)
    result = Image.fromarray(hsv, "HSV").convert("RGBA")
    result.putalpha(frame.getchannel("A"))
    return result


def interior(image: Image.Image) -> Image.Image:
    """Crop to the largest ROOM_SIZE-shaped rectangle that holds none of the backdrop around the room, as low as possible."""
    step = 4
    small = image.convert("RGB").resize((image.width // step, image.height // step), Image.Resampling.NEAREST)
    marker = (255, 0, 255)
    for corner in [(0, 0), (small.width - 1, 0), (0, small.height - 1), (small.width - 1, small.height - 1)]:
        ImageDraw.floodfill(small, corner, marker, thresh=40)
    backdrop = (np.asarray(small) == marker).all(axis=-1).astype(int)
    sums = np.pad(backdrop.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    aspect = ROOM_SIZE[0] / ROOM_SIZE[1]
    best, low, high = None, 1, small.height
    while low <= high:
        h = (low + high) // 2
        w = round(h * aspect)
        clear = w <= small.width and (
            sums[h:, w:] - sums[:-h, w:] - sums[h:, :-w] + sums[:-h, :-w] == 0
        )
        if w <= small.width and clear.any():
            ys, xs = np.nonzero(clear)
            lowest = ys == ys.max()
            x = int(np.round(np.median(xs[lowest])))
            best, low = (x, int(ys.max()), w, h), h + 1
        else:
            high = h - 1
    x, y, w, h = (v * step for v in best)
    # Inset a little so the room's own outer edge lines do not show as a strip along the border.
    dx, dy = round(w * 0.02), round(h * 0.02)
    return image.crop((x + dx, y + dy, x + w - dx, y + h - dy))


def worker_frames(path: Path) -> list[Image.Image]:
    sheet = np.asarray(Image.open(path).convert("RGBA")).copy()
    r, g, b = (sheet[..., i].astype(int) for i in range(3))
    # Magenta and its darker shadow tones: red and blue high, green well below both.
    sheet[(r > 110) & (b > 110) & (g < np.minimum(r, b) * 0.55), 3] = 0
    image = Image.fromarray(sheet)
    cell = image.width // 2
    frames = []
    for index in range(len(STATES)):
        x, y = (index % 2) * cell, (index // 2) * cell
        crop = image.crop((x, y, x + cell, y + cell))
        frame = crop.resize((round(cell / AGENT_PIXEL),) * 2, Image.Resampling.BOX)
        pixels = np.asarray(frame).copy()
        pixels[..., 3] = np.where(pixels[..., 3] > 140, 255, 0)
        frame = quantize(Image.fromarray(pixels))
        frames.append(frame.crop(frame.getbbox()))
    return frames


shutil.rmtree(out, ignore_errors=True)
manifest = {"states": STATES, "variants": len(SHIRT_HUES), "room": dict(zip("wh", ROOM_SIZE)), "vibes": {}}
for vibe_dir in sorted(p for p in raw.iterdir() if p.is_dir()):
    vibe = vibe_dir.name
    (out / vibe).mkdir(parents=True)
    rooms, workers = [], []
    for path in sorted(vibe_dir.glob("room-*.png")):
        room = interior(Image.open(path).convert("RGBA")).resize(ROOM_SIZE, Image.Resampling.BOX)
        quantize(room).save(out / vibe / path.name)
        rooms.append(path.stem.removeprefix("room-"))
    for path in sorted(vibe_dir.glob("worker-*.png")):
        name = path.stem.removeprefix("worker-")
        for state, frame in zip(STATES, worker_frames(path)):
            for variant, hue in enumerate(SHIRT_HUES):
                recolor(frame, hue).save(out / vibe / f"{name}-{state}-{variant}.png")
        workers.append(name)
    manifest["vibes"][vibe] = {"rooms": rooms, "workers": workers}

(out / "manifest.js").write_text(f"window.ASSETS = {json.dumps(manifest)};\n")
print(json.dumps(manifest["vibes"]))
