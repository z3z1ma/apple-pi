#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow", "numpy"]
# ///
"""Agent World art pipeline: generate art with Codex, then cut, scale, quantize, and check it.

Raw art lives in apps/agent-world/art/raw/<theme>/ (repository only); cleaned art goes to
apps/agent-world/themes/<theme>/ (shipped). STYLE.md is the standard every command follows.

  pipeline.py prompt KIND THEME BRIEF [--grid G] [--slots S] [--seat S]   print the prompt
  pipeline.py generate KIND THEME OUT.png BRIEF [...]                       generate with Codex (keeps existing files)
  pipeline.py scene RAW OUT                                                 quantize a painted scene to 256 colours
  pipeline.py sheet RAW OUT.png                                             cut a 4x4 character sheet into a 16-frame strip
  pipeline.py portraits RAW OUTPREFIX                                       cut a 2x2 portrait grid into OUTPREFIX-0..3.png
  pipeline.py pieces RAW OUTDIR NAME...                                     cut a row of pieces into OUTDIR/NAME.png
  pipeline.py check FILE...                                                 fail on magenta fringe or frames off the baseline
  pipeline.py batch THEME                                                   generate every missing piece in briefs/THEME.json, in parallel
  pipeline.py build THEME                                                   clean all of raw/THEME into themes/THEME and check it
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
STANDING_HEIGHT = 120
PORTRAIT_HEIGHT = 360
LIGHT = {
    "fantasy": "warm candlelit fantasy lighting",
    "tech-office": "warm late-afternoon office lighting",
    "anime-school": "golden after-school sunlight",
}
SEAT = {"fantasy": "a small wooden stool", "tech-office": "an office chair", "anime-school": "a classroom chair"}


def magenta_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Wide on purpose: generated edges blend into the magenta, and a narrow key leaves a purple fringe.
    return (r > 140) & (b > 140) & (g < 0.62 * np.minimum(r, b)) & (np.abs(r - b) < 90)


def prompt(kind, theme, brief, grid="30 squares wide and 20 deep", slots="none", seat=None):
    template = (HERE / "prompts" / f"{kind}.txt").read_text().strip()
    style = (HERE / "prompts" / f"style-{theme}.txt").read_text().strip()
    return template.format(
        brief=brief, grid=grid, slots=slots, style=style, light=LIGHT[theme], seat=seat or SEAT[theme]
    )


def generate(out, text, reference=None):
    out = Path(out).resolve()
    if out.exists():
        print(f"kept {out}")
        return
    out.parent.mkdir(parents=True, exist_ok=True)
    log = out.with_suffix(".log")
    attach = []
    if reference is not None:
        # Without the look's own sheet beside it, a text brief alone drew a different person.
        attach = ["-i", str(Path(reference).resolve())]
        text = (
            "The attached image is this character's sprite sheet: draw exactly the same character, with the same "
            f"face, hair, clothes, colours, and proportions. {text}"
        )
    with log.open("w") as f:
        subprocess.run(
            [
                "codex",
                "exec",
                "-s",
                "workspace-write",
                "--skip-git-repo-check",
                f"Use your image generation tool to create this image, then save the PNG as ./{out.name}. "
                f"Do not create or edit any other file. Image: {text}",
                # After the prompt: `-i` takes several files and would swallow a prompt that followed it.
                *attach,
            ],
            cwd=out.parent,
            stdout=f,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if not out.exists():
        sys.exit(f"FAILED {out} (see {log})")
    shrink(out)
    print(f"made {out}")


def shrink(path):
    # Raw art is kept in the repository, which Pi clones on install, so it is stored at 256 colours.
    img = Image.open(path).convert("RGB")
    img.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(path, optimize=True)


def bands(filled, min_gap, min_size):
    found, start, gap = [], None, 0
    for i, f in enumerate(filled):
        if f:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                if i - gap + 1 - start >= min_size:
                    found.append((start, i - gap + 1))
                start, gap = None, 0
    if start is not None and len(filled) - start >= min_size:
        found.append((start, len(filled)))
    return found


def main_body(m):
    # Keep the band of rows holding most of the figure, so a speck from a neighbouring cell cannot lift it off the
    # baseline.
    found = bands(m.any(axis=1), 4, 1)
    y0, y1 = max(found, key=lambda band: m[band[0] : band[1]].sum())
    m = m.copy()
    m[:y0] = False
    m[y1:] = False
    return m


def cut(path, rows, cols, gap=6, body=False):
    rgb = np.array(Image.open(path).convert("RGB")).astype(int)
    keep = ~magenta_mask(rgb)
    row_bands = bands(keep.sum(axis=1) > 2, 6, 20)
    if rows and len(row_bands) != rows:
        # A pose can reach into the gap (a raised hand), so fall back to the equal cells the sheet was drawn on.
        h = keep.shape[0] / rows
        row_bands = [(round(i * h), round((i + 1) * h)) for i in range(rows)]
    found = []
    for y0, y1 in row_bands:
        col_bands = bands(keep[y0:y1].sum(axis=0) > 2, gap, 12)
        if cols and len(col_bands) != cols:
            w = keep.shape[1] / cols
            col_bands = [(round(i * w), round((i + 1) * w)) for i in range(cols)]
        for x0, x1 in col_bands:
            if not keep[y0:y1, x0:x1].any():
                sys.exit(f"{Path(path).name}: an empty cell at {x0},{y0}")
            m = main_body(keep[y0:y1, x0:x1]) if body else keep[y0:y1, x0:x1]
            ys, xs = np.where(m)
            yy0, yy1, xx0, xx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
            rgba = np.zeros((yy1 - yy0, xx1 - xx0, 4), dtype=np.uint8)
            rgba[..., :3] = rgb[y0 + yy0 : y0 + yy1, x0 + xx0 : x0 + xx1]
            rgba[..., 3] = np.where(m[yy0:yy1, xx0:xx1], 255, 0)
            found.append(Image.fromarray(rgba))
    return found


def hard_alpha(img):
    # Hard alpha after resampling, so edges stay crisp against the painted places.
    a = np.array(img.convert("RGBA"))
    a[..., 3] = np.where(a[..., 3] > 110, 255, 0)
    a[magenta_mask(a[..., :3].astype(int)), 3] = 0
    return Image.fromarray(defringe(a))


def interior(opaque):
    # Padded, not rolled: a pixel on the image's border is an edge, while a roll would wrap it to the far side.
    p = np.pad(opaque, 1)
    return p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:]


def defringe(a):
    # Edge pixels blended with the magenta background are pinkish rather than magenta; peel them off the outline.
    # The blend is at most two pixels deep; peeling further would eat real purple cloth or hair.
    for _ in range(2):
        opaque = a[..., 3] > 0
        edge = opaque & ~interior(opaque)
        r, g, b = (a[..., i].astype(int) for i in range(3))
        pink = (r > 110) & (b > 90) & (g < 0.8 * np.minimum(r, b)) & (b > 0.55 * r)
        a[edge & pink, 3] = 0
    return a


def save_sprite(img, path):
    # 255 colours plus transparency keeps shipped sprites small without visible loss.
    img.quantize(255, method=Image.Quantize.FASTOCTREE).save(path, optimize=True)


def scene(raw, out):
    img = Image.open(raw).convert("RGB")
    img.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, optimize=True)
    print(f"scene {out} {img.size}")


def sheet(raw, out):
    frames = cut(raw, 4, 4, body=True)
    # Codex draws each row at its own scale, so each row is scaled on its own: a walking row by its median height, the
    # last row (seated, seated, standing, asking) by its standing frame. Otherwise a figure changes size as it sits.
    scales = [STANDING_HEIGHT / float(np.median([f.height for f in frames[r * 4 : r * 4 + 4]])) for r in range(3)]
    scales.append(STANDING_HEIGHT / frames[14].height)
    save_strip(frames, [scales[i // 4] for i in range(len(frames))], out, "sheet")


def idle(raw, out):
    # Eight standing idle poses (look left, look right, stretch, wave, laugh, shrug, nod, yawn), scaled together by
    # their median height so the figure keeps its size from pose to pose.
    frames = cut(raw, 2, 4, body=True)
    s = STANDING_HEIGHT / float(np.median([f.height for f in frames]))
    save_strip(frames, [s] * len(frames), out, "idle")


def save_strip(frames, scales, out, label):
    frames = [
        f.resize((max(1, round(f.width * s)), max(1, round(f.height * s))), Image.Resampling.LANCZOS)
        for f, s in zip(frames, scales)
    ]
    # Clean each frame before placing it, so its feet sit exactly on the baseline.
    frames = [hard_alpha(f) for f in frames]
    frames = [f.crop(f.getbbox()) for f in frames]
    cw = max(f.width for f in frames) + 4
    ch = max(f.height for f in frames) + 4
    baseline = ch - 2
    strip = Image.new("RGBA", (cw * len(frames), ch))
    for i, f in enumerate(frames):
        strip.paste(f, (i * cw + (cw - f.width) // 2, baseline - f.height), f)
    save_sprite(strip, out)
    meta = {"frameWidth": cw, "frameHeight": ch, "frames": len(frames), "baseline": baseline}
    Path(out).with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{label} {out} {meta}")


def portraits(raw, prefix):
    for i, bust in enumerate(cut(raw, 2, 2)):
        s = PORTRAIT_HEIGHT / bust.height
        img = hard_alpha(bust.resize((round(bust.width * s), PORTRAIT_HEIGHT), Image.Resampling.LANCZOS))
        save_sprite(img, f"{prefix}-{i}.png")
    print(f"portraits {prefix}-0..3.png")


def pieces(raw, outdir, names):
    # Pieces stand in one row, and we know how many there are: widen the gap that separates them until a puff of
    # smoke or a sparkle stays with its piece.
    found = []
    for gap in (6, 12, 20, 32, 48):
        found = cut(raw, 1, 0, gap=gap)
        if len(found) <= len(names):
            break
    if len(found) != len(names):
        sys.exit(f"{Path(raw).name}: expected {len(names)} pieces, found {len(found)}")
    Path(outdir).mkdir(parents=True, exist_ok=True)
    for name, piece in zip(names, found):
        save_sprite(hard_alpha(piece), Path(outdir) / f"{name}.png")
        print(f"piece {name} {piece.size}")


def problems(path):
    path = Path(path)
    img = np.array(Image.open(path).convert("RGBA")).astype(int)
    found = []
    opaque = img[..., 3] > 0
    fringe = int((magenta_mask(img[..., :3]) & opaque).sum())
    if fringe:
        found.append(f"{path.name}: {fringe} magenta or purple pixels")
    meta_path = path.with_suffix(".json")
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        w, base = meta["frameWidth"], meta["baseline"]
        if img.shape[1] != w * meta["frames"]:
            found.append(f"{path.name}: width {img.shape[1]} is not {meta['frames']} frames of {w}")
        for i in range(meta["frames"]):
            rows = np.where(opaque[:, i * w : (i + 1) * w].any(axis=1))[0]
            if len(rows) == 0:
                found.append(f"{path.name}: frame {i} is empty")
            elif rows[-1] + 1 != base:
                found.append(f"{path.name}: frame {i} ends at {rows[-1] + 1}, not the baseline {base}")
    return found


def raw_jobs(theme):
    briefs = json.loads((HERE / "briefs" / f"{theme}.json").read_text())
    raw = HERE / "raw" / theme
    jobs = []
    for name, b in briefs.get("scenes", {}).items():
        jobs.append(
            (raw / "places" / f"{name}.png", prompt("scene", theme, b["brief"], b["grid"], b.get("slots", "none")))
        )
    for name, brief in briefs.get("sheets", {}).items():
        jobs.append((raw / "characters" / f"{name}-sheet.png", prompt("sheet", theme, brief)))
        jobs.append((raw / "characters" / f"{name}-portrait.png", prompt("portrait", theme, brief)))
        jobs.append(
            (
                raw / "characters" / f"{name}-idle.png",
                prompt("idle", theme, brief),
                raw / "characters" / f"{name}-sheet.png",
            )
        )
    for name, b in briefs.get("pieces", {}).items():
        jobs.append((raw / "overlays" / f"{name}.png", prompt("pieces", theme, b["brief"])))
    return briefs, raw, jobs


def batch(theme):
    _, _, jobs = raw_jobs(theme)
    missing = [job for job in jobs if not job[0].exists()]
    failed = []

    def run(job):
        try:
            generate(*job)
        except SystemExit as e:
            failed.append(str(e))

    with ThreadPoolExecutor(max_workers=len(missing) or 1) as pool:
        list(pool.map(run, missing))
    for f in failed:
        print(f)
    if failed:
        sys.exit(1)


HOSTS = {"innkeeper", "smith", "clerk", "librarian", "rookery-keeper", "crier", "recruiter"}


def role_of(look):
    if look.startswith("avatar-"):
        return "avatar"
    if look.startswith("townsfolk-"):
        return "townsfolk"
    if look.startswith("ambient-"):
        return "ambient"
    if look in HOSTS:
        return look
    return "coordinator" if look == "coordinator" else "agent"


def build(theme):
    briefs, raw, _ = raw_jobs(theme)
    out = HERE.parent / "themes" / theme
    for d in ("places", "characters", "overlays"):
        (out / d).mkdir(parents=True, exist_ok=True)
    for name in briefs.get("scenes", {}):
        scene(raw / "places" / f"{name}.png", out / "places" / f"{name}.png")
    looks = {}
    for name in briefs.get("sheets", {}):
        sheet(raw / "characters" / f"{name}-sheet.png", out / "characters" / f"{name}.png")
        portraits(raw / "characters" / f"{name}-portrait.png", out / "characters" / f"{name}-portrait")
        meta = json.loads((out / "characters" / f"{name}.json").read_text())
        role = role_of(name)
        looks[name] = {"role": role, "frame": [meta["frameWidth"], meta["frameHeight"]], "baseline": meta["baseline"]}
        if (raw / "characters" / f"{name}-idle.png").exists():
            idle(raw / "characters" / f"{name}-idle.png", out / "characters" / f"{name}-idle.png")
            meta = json.loads((out / "characters" / f"{name}-idle.json").read_text())
            looks[name]["idle"] = {"frame": [meta["frameWidth"], meta["frameHeight"]], "baseline": meta["baseline"]}
    (out / "characters" / "looks.json").write_text(json.dumps(looks, indent=2) + "\n")
    for name, b in briefs.get("pieces", {}).items():
        pieces(raw / "overlays" / f"{name}.png", out / "overlays", b["names"])
    files = [f for d in ("characters", "overlays") for f in sorted((out / d).glob("*.png"))]
    found = [x for f in files for x in problems(f)]
    for x in found:
        print(x)
    if found:
        sys.exit(1)
    print(f"built {theme}: {len(files)} sprites checked")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("prompt", "generate"):
        s = sub.add_parser(name)
        s.add_argument("kind", choices=["scene", "sheet", "portrait", "pieces", "idle"])
        s.add_argument("theme", choices=sorted(LIGHT))
        if name == "generate":
            s.add_argument("out")
        s.add_argument("brief")
        s.add_argument("--grid", default="30 squares wide and 20 deep")
        s.add_argument("--slots", default="none")
        s.add_argument("--seat")
    for name, args in (("scene", ["raw", "out"]), ("sheet", ["raw", "out"]), ("portraits", ["raw", "prefix"])):
        s = sub.add_parser(name)
        for a in args:
            s.add_argument(a)
    s = sub.add_parser("pieces")
    s.add_argument("raw")
    s.add_argument("outdir")
    s.add_argument("names", nargs="+")
    s = sub.add_parser("check")
    s.add_argument("files", nargs="+")
    for name in ("batch", "build"):
        sub.add_parser(name).add_argument("theme", choices=sorted(LIGHT))
    a = p.parse_args(argv)
    if a.cmd in ("prompt", "generate"):
        text = prompt(a.kind, a.theme, a.brief, a.grid, a.slots, a.seat)
        if a.cmd == "prompt":
            print(text)
        else:
            generate(a.out, text)
    elif a.cmd == "scene":
        scene(a.raw, a.out)
    elif a.cmd == "sheet":
        sheet(a.raw, a.out)
    elif a.cmd == "portraits":
        portraits(a.raw, a.prefix)
    elif a.cmd == "pieces":
        pieces(a.raw, a.outdir, a.names)
    elif a.cmd == "batch":
        batch(a.theme)
    elif a.cmd == "build":
        build(a.theme)
    else:
        found = [x for f in a.files for x in problems(f)]
        for x in found:
            print(x)
        if found:
            sys.exit(1)
        print(f"ok {len(a.files)} files")


if __name__ == "__main__":
    main()
