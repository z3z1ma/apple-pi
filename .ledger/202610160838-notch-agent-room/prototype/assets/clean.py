"""PROTOTYPE: turn raw generated images into crisp pixel assets for web/assets.

raw/<vibe>/room-<name>.png  -> web/assets/<vibe>/room-<name>.png (250×140 art pixels)
raw/<vibe>/worker-<name>.png -> web/assets/<vibe>/<name>-<state>-<variant>.png (2×2 sheet of poses, magenta background)
and web/assets/manifest.js, which tells the page which vibes, rooms, and workers exist.

Run: uv run -q -w pillow -w numpy python assets/clean.py
"""

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw", here.parent / "web" / "assets"

ROOM_SIZE = (250, 140)  # about 5.5 raw pixels per art pixel for a 1376×768 generation
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
        room = Image.open(path).convert("RGBA").resize(ROOM_SIZE, Image.Resampling.BOX)
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
