"""PROTOTYPE (throwaway): cut and scale the Codex art in raw/ into 32 px-tile assets for the Agent World town.

Writes assets/*.png and assets/manifest.js (sizes, frame sizes), so index.html needs no extra metadata.
Run from this directory: uv run -q -w pillow -w numpy python clean.py
"""

import json
from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
raw, out = here / "raw", here / "assets"
TILE = 32
CHAR_HEIGHT = 40  # art pixels from head to feet
COLORS = 64

# sheet -> (mode, [(asset name, width in tiles)]) ; pieces are matched in reading order
SHEETS = {
    "houses-small": ("pieces", [("cottage-1", 4), ("cottage-2", 4), ("cottage-3", 4), ("cottage-4", 4)]),
    "houses-medium": ("pieces", [("house-1", 4), ("house-2", 4), ("house-3", 4)]),
    "hq": ("single", [("hq", 9)]),
    "wings": ("pieces", [("wing-1", 3), ("wing-2", 3), ("wing-3", 3), ("wing-4", 3)]),
    "hub-questboard": ("single", [("hub-jira", 6)]),
    "hub-forge": ("single", [("hub-github", 7)]),
    "hub-library": ("single", [("hub-confluence", 8)]),
    "hub-square": ("pieces", [("stall-1", 3), ("stall-2", 3), ("fountain", 4), ("stall-3", 3)]),
    "props": (
        "pieces",
        [
            ("oak", 3), ("pine", 2), ("blossom", 3), ("bush", 2),
            ("lamp", 1), ("bench", 2), ("fence", 2), ("flowerbed", 2),
            ("barrel", 1), ("crates", 2), ("signpost", 1.5), ("well", 2),
        ],
    ),
}
WALKERS = ["char-a", "char-b", "char-c", "char-d", "char-coord"]


def magenta(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    return (r > 170) & (b > 170) & (g < 120)


def cutout(img: Image.Image) -> Image.Image:
    rgba = np.asarray(img.convert("RGBA")).copy()
    rgba[magenta(rgba[..., :3]), 3] = 0
    return Image.fromarray(rgba, "RGBA")


def crop(img: Image.Image) -> Image.Image:
    box = img.getchannel("A").getbbox()
    return img.crop(box) if box else img


def finish(img: Image.Image, width: int) -> Image.Image:
    height = max(1, round(img.height * width / img.width))
    small = img.resize((width, height), Image.Resampling.BOX)
    alpha = small.getchannel("A").point(lambda a: 255 if a > 140 else 0)
    q = small.convert("RGB").quantize(COLORS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    q.putalpha(alpha)
    return q


def pieces(img: Image.Image) -> list[Image.Image]:
    cut = cutout(img)
    alpha = np.asarray(cut.getchannel("A")) > 0
    step = 8
    small = Image.fromarray((alpha * 255).astype(np.uint8)).resize((img.width // step, img.height // step), Image.Resampling.BOX)
    mask = np.asarray(small) > 30
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
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        if len(xs) > 40:
            boxes.append([min(xs) * step, min(ys) * step, (max(xs) + 1) * step, (max(ys) + 1) * step])
    # reading order: group into rows by vertical centre, then left to right
    boxes.sort(key=lambda b: (b[1] + b[3]) / 2)
    rows: list[list[list[int]]] = []
    for b in boxes:
        centre = (b[1] + b[3]) / 2
        if rows and abs(centre - (rows[-1][0][1] + rows[-1][0][3]) / 2) < img.height / 8:
            rows[-1].append(b)
        else:
            rows.append([b])
    ordered = [b for row in rows for b in sorted(row, key=lambda b: b[0])]
    return [crop(cut.crop(tuple(b))) for b in ordered]


def walker(img: Image.Image) -> tuple[Image.Image, int, int]:
    """Cut a 4x4 walk sheet into equal frames that share one crop, so feet stay put between frames."""
    w, h = img.width // 4, img.height // 4
    cells = [cutout(img.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))) for r in range(4) for c in range(4)]
    boxes = [c.getchannel("A").getbbox() for c in cells]
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    scale = CHAR_HEIGHT / (bottom - top)
    fw, fh = round((right - left) * scale), CHAR_HEIGHT
    fw += fw % 2
    sheet = Image.new("RGBA", (fw * 4, fh * 4), (0, 0, 0, 0))
    for i, cell in enumerate(cells):
        frame = finish(cell.crop((left, top, right, bottom)), fw)
        frame = frame.resize((fw, fh), Image.Resampling.NEAREST)
        sheet.alpha_composite(frame, ((i % 4) * fw, (i // 4) * fh))
    return sheet, fw, fh


def main() -> None:
    out.mkdir(exist_ok=True)
    manifest: dict = {"tile": TILE, "images": {}, "walkers": {}}
    for sheet, (mode, names) in SHEETS.items():
        img = Image.open(raw / f"{sheet}.png")
        found = [crop(cutout(img))] if mode == "single" else pieces(img)
        if len(found) != len(names):
            print(f"warning: {sheet} has {len(found)} pieces, expected {len(names)}")
        for (name, tiles), piece in zip(names, found):
            asset = finish(piece, round(tiles * TILE))
            asset.save(out / f"{name}.png")
            manifest["images"][name] = [asset.width, asset.height]
    for name in WALKERS:
        sheet, fw, fh = walker(Image.open(raw / f"{name}.png"))
        sheet.save(out / f"{name}.png")
        manifest["walkers"][name] = [fw, fh]
    (out / "manifest.js").write_text("window.ASSETS = " + json.dumps(manifest) + ";\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
