"""The art pipeline cuts generated sheets into clean, baseline-aligned frames."""

import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("pipeline", Path(__file__).resolve().parents[1] / "pipeline.py")
pipeline = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pipeline)

MAGENTA = (255, 0, 255)
FRINGE = (200, 60, 190)


def figure(draw_into, x, y, h):
    # A body with a fringe of blended magenta around it, as generated art has.
    draw_into[y - 2 : y + h + 2, x - 2 : x + 22] = FRINGE
    draw_into[y : y + h, x : x + 20] = (90, 60, 40)


def generated_sheet(path, rng):
    img = np.zeros((4 * 140, 4 * 100, 3), dtype=np.uint8)
    img[:] = MAGENTA
    for r in range(4):
        for c in range(4):
            h = int(rng.integers(90, 110))
            figure(img, c * 100 + 30, r * 140 + 15 + int(rng.integers(0, 10)), h)
    Image.fromarray(img).save(path)


def test_a_sheet_becomes_sixteen_frames_on_one_baseline_without_fringe(tmp_path):
    raw, out = tmp_path / "raw.png", tmp_path / "out.png"
    generated_sheet(raw, np.random.default_rng(1))
    pipeline.sheet(raw, out)
    meta = json.loads(out.with_suffix(".json").read_text())
    assert meta["frames"] == 16
    assert pipeline.problems(out) == []


def test_check_reports_fringe_and_a_frame_off_the_baseline(tmp_path):
    raw, out = tmp_path / "raw.png", tmp_path / "out.png"
    generated_sheet(raw, np.random.default_rng(2))
    pipeline.sheet(raw, out)
    img = np.array(Image.open(out).convert("RGBA"))
    meta = json.loads(out.with_suffix(".json").read_text())
    img[meta["baseline"] - 1, :, 3] = 0  # lift every frame off the baseline
    img[5, meta["frameWidth"] // 2] = (*FRINGE, 255)
    Image.fromarray(img).save(out)
    found = pipeline.problems(out)
    assert any("magenta" in x for x in found)
    assert any("not the baseline" in x for x in found)


def test_a_scene_is_quantized_to_256_colours(tmp_path):
    raw, out = tmp_path / "raw.png", tmp_path / "out.png"
    Image.fromarray(np.random.default_rng(3).integers(0, 255, (64, 96, 3), dtype=np.uint8)).save(raw)
    pipeline.scene(raw, out)
    img = Image.open(out)
    assert img.size == (96, 64)
    assert len(img.convert("RGB").getcolors(100000)) <= 256


def test_prompts_state_the_grid_and_walk_phases():
    scene = pipeline.prompt("scene", "fantasy", "A guild hall.", grid="16 squares wide and 16 deep")
    assert "16 squares wide and 16 deep" in scene and "1.5 squares tall" in scene and "no seats" in scene.lower()
    sheet = pipeline.prompt("sheet", "tech-office", "A developer.")
    assert "contact" in sheet and "passing" in sheet and "an office chair" in sheet and "NO desk" in sheet


def test_a_raised_hand_that_closes_the_gap_between_rows_still_gives_sixteen_frames(tmp_path):
    raw, out = tmp_path / "raw.png", tmp_path / "out.png"
    generated_sheet(raw, np.random.default_rng(4))
    img = np.array(Image.open(raw))
    img[270:440, 335:340] = (90, 60, 40)  # the last frame's raised arm reaches into the row above it
    Image.fromarray(img).save(raw)
    pipeline.sheet(raw, out)
    assert json.loads(out.with_suffix(".json").read_text())["frames"] == 16
    assert pipeline.problems(out) == []


def test_a_piece_cut_to_the_image_edge_loses_its_pink_fringe(tmp_path):
    raw, out = tmp_path / "raw.png", tmp_path / "pieces"
    img = np.zeros((80, 200, 3), dtype=np.uint8)
    img[:] = MAGENTA
    for x in (20, 120):
        img[10:70, x : x + 40] = (130, 12, 133)  # a dark blend of the key colour, outside the magenta key
        img[12:68, x + 2 : x + 38] = (90, 60, 40)
    Image.fromarray(img).save(raw)
    pipeline.pieces(raw, out, ["left", "right"])
    for name in ("left", "right"):
        piece = np.array(Image.open(out / f"{name}.png").convert("RGBA")).astype(int)
        opaque = piece[..., 3] > 0
        pink = opaque & (piece[..., 0] > 110) & (piece[..., 2] > 90) & (piece[..., 1] < 60)
        assert not pink.any()
