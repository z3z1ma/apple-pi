"""PROTOTYPE (throwaway): turn raw Codex art into pixel assets for the Guild Hall prototype.

raw/codex/room-*.png  -> assets/<density>/room-*.png   (backdrop cropped, room scaled to ROOM_TILES tiles wide)
raw/codex/props.png   -> assets/<density>/prop-<n>.png  (connected pieces cut from magenta)
raw/codex/char-*.png  -> assets/<density>/<name>-<pose>.png (2x2 sheet split, magenta removed, scaled to CHAR_TILES tall)
and assets/manifest.js listing sizes, so index.html needs no server.

Run from this directory: uv run -q -w pillow -w numpy python clean.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

here = Path(__file__).resolve().parent
raw, out = here / "raw" / "codex", here / "assets"

DENSITIES = {"t16": 16, "t32": 32}  # art pixels per floor tile
ROOM_TILES = 20  # room width in tiles
CHAR_TILES = 2.0  # character height in tiles (32 px at t16, 64 px at t32)
PROP_TILES = [6.0, 3.0, 1.7, 1.9, 2.2, 1.0, 1.3]  # width in tiles of each prop, in reading order of the sheet
COLORS = 48
POSES = ["idle", "busy", "waiting", "asleep"]  # sheet order: left to right, top to bottom


def is_magenta(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    return (r > 180) & (b > 180) & (g < 110)


def quantize(img: Image.Image) -> Image.Image:
    alpha = img.getchannel("A")
    q = img.convert("RGB").quantize(COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    q.putalpha(alpha.point(lambda a: 255 if a > 127 else 0))
    return q


def shrink(img: Image.Image, width: int) -> Image.Image:
    """Box-downsample (keeps colour areas faithful), then snap alpha and palette."""
    height = max(1, round(img.height * width / img.width))
    return quantize(img.resize((width, height), Image.Resampling.BOX))


def cut_magenta(img: Image.Image) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).copy()
    rgba[is_magenta(rgba[..., :3]), 3] = 0
    return Image.fromarray(rgba, "RGBA")


def bbox_crop(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").getbbox()
    return img.crop(box) if box else img


def room(source: Image.Image) -> Image.Image:
    """Make the navy backdrop transparent by flood fill from the corners, then crop to the room."""
    img = source.convert("RGB")
    marker = (255, 0, 255)
    for corner in [(0, 0), (img.width - 1, 0), (0, img.height - 1), (img.width - 1, img.height - 1)]:
        ImageDraw.floodfill(img, corner, marker, thresh=40)
    return bbox_crop(cut_magenta(img))


def pieces(img: Image.Image) -> list[Image.Image]:
    """Split a magenta sheet into its separate objects, largest gaps first, in reading order."""
    cut = cut_magenta(img)
    alpha = np.asarray(cut.getchannel("A")) > 0
    small = Image.fromarray((alpha * 255).astype(np.uint8)).resize((img.width // 8, img.height // 8), Image.Resampling.BOX)
    mask = np.asarray(small) > 20
    seen = np.zeros_like(mask)
    boxes = []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        stack, xs, ys = [(y, x)], [], []
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            xs.append(cx)
            ys.append(cy)
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if len(xs) > 30:
            boxes.append((min(xs) * 8, min(ys) * 8, (max(xs) + 1) * 8, (max(ys) + 1) * 8))
    boxes.sort(key=lambda b: (round(b[1] / (img.height / 3)), b[0]))
    return [bbox_crop(cut.crop(b)) for b in boxes]


def main() -> None:
    manifest: dict = {}
    for key, tile in DENSITIES.items():
        dest = out / key
        dest.mkdir(parents=True, exist_ok=True)
        entry: dict = {"tile": tile, "rooms": {}, "props": [], "chars": {}}
        for path in sorted(raw.glob("room-*.png")):
            img = shrink(room(Image.open(path)), ROOM_TILES * tile)
            img.save(dest / path.name)
            entry["rooms"][path.stem] = [img.width, img.height]
        sheet = raw / "props.png"
        if sheet.exists():
            for i, piece in enumerate(pieces(Image.open(sheet))):
                width = round((PROP_TILES[i] if i < len(PROP_TILES) else 1.5) * tile)
                img = shrink(piece, width)
                img.save(dest / f"prop-{i}.png")
                entry["props"].append([img.width, img.height])
        for path in sorted(raw.glob("char-*.png")):
            sheet_img = Image.open(path).convert("RGB")
            w, h = sheet_img.width // 2, sheet_img.height // 2
            name = path.stem.removeprefix("char-")
            entry["chars"][name] = {}
            cells = [bbox_crop(cut_magenta(sheet_img.crop(((i % 2) * w, (i // 2) * h, (i % 2 + 1) * w, (i // 2 + 1) * h)))) for i in range(4)]
            scale = CHAR_TILES * tile / cells[0].height  # the idle pose sets one scale for every pose
            for pose, cell in zip(POSES, cells):
                img = shrink(cell, max(1, round(cell.width * scale)))
                img.save(dest / f"{name}-{pose}.png")
                entry["chars"][name][pose] = [img.width, img.height]
        manifest[key] = entry
    (out / "manifest.js").write_text("window.ASSETS = " + json.dumps(manifest, indent=1) + ";\n")
    print(json.dumps({k: {"rooms": v["rooms"], "props": len(v["props"]), "chars": list(v["chars"])} for k, v in manifest.items()}))


if __name__ == "__main__":
    main()
