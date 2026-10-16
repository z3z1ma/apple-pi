"""PROTOTYPE: turn raw generated images into crisp pixel assets for web/assets.

Run: uv run -q -w pillow -w numpy python assets/clean.py
"""

from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw", here.parent / "web" / "assets"
out.mkdir(parents=True, exist_ok=True)

ROOM_PIXEL = 5.5  # raw pixels per art pixel in room.png, from run-length analysis
AGENT_PIXEL = 10  # agents drawn at half their generated detail so several fit in one room
COLORS = 48
STATES = ["working", "quiet", "waiting", "done"]  # sheet order: left to right, top to bottom
HOODIE_HUES = [None, 0, 120, 280, 330, 170]  # None keeps the generated blue; others are target hues in degrees


def pixelate(image: Image.Image, factor: float) -> Image.Image:
    size = (round(image.width / factor), round(image.height / factor))
    return image.resize(size, Image.Resampling.BOX)


def quantize(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    rgb = image.convert("RGB").quantize(COLORS, method=Image.Quantize.MEDIANCUT).convert("RGBA")
    rgb.putalpha(alpha)
    return rgb


def recolor(frame: Image.Image, hue: int | None) -> Image.Image:
    """Move the hoodie's blue pixels to another hue; dark hair and grey laptop stay put."""
    if hue is None:
        return frame
    hsv = np.asarray(frame.convert("RGB").convert("HSV")).copy()
    h, s, v = (hsv[..., i].astype(int) for i in range(3))
    blue = (h > 135) & (h < 175) & (s > 90) & (v > 90)
    hsv[..., 0] = np.where(blue, round(hue / 360 * 255), h)
    result = Image.fromarray(hsv, "HSV").convert("RGBA")
    result.putalpha(frame.getchannel("A"))
    return result


room = quantize(pixelate(Image.open(raw / "room.png").convert("RGBA"), ROOM_PIXEL))
room.save(out / "room.png")

sheet = np.asarray(Image.open(raw / "agent-sheet.png").convert("RGBA")).copy()
r, g, b = (sheet[..., i].astype(int) for i in range(3))
magenta = (r > 180) & (b > 180) & (g < 120)
sheet[magenta, 3] = 0
sheet_image = Image.fromarray(sheet)
cell = sheet_image.width // 2
for index, state in enumerate(STATES):
    x, y = (index % 2) * cell, (index // 2) * cell
    frame = pixelate(sheet_image.crop((x, y, x + cell, y + cell)), AGENT_PIXEL)
    pixels = np.asarray(frame).copy()
    pixels[..., 3] = np.where(pixels[..., 3] > 140, 255, 0)
    frame = quantize(Image.fromarray(pixels))
    frame = frame.crop(frame.getbbox())
    for variant, hue in enumerate(HOODIE_HUES):
        recolor(frame, hue).save(out / f"agent-{state}-{variant}.png")

print("room", room.size, *(f"{s} {Image.open(out / f'agent-{s}-0.png').size}" for s in STATES))
