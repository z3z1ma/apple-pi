# PROTOTYPE: Guild Hall art and scale

Throwaway prototype for [Guild Hall art and scale](../../decisions/04-guild-hall-art-and-scale.md). All agents are mock data.

## Question

Which tile scale, camera angle, and asset pipeline give the storybook feel of the approved concept, with readable characters and status?

## Run

Open `index.html` in a browser (no server). Switch variants with the bottom bar, the arrow keys, or `?variant=A|B|C`. `N` toggles name plates; click a hero for the inspector; `Esc` closes it.

| Variant | Camera | Density | Room size |
| --- | --- | --- | --- |
| A | 3/4 top-down | 32 px tiles, heroes 64 px tall | 640 × 403 art px |
| B | 3/4 top-down | 16 px tiles, heroes 32 px tall | 320 × 201 art px |
| C | isometric | 32 px tiles, heroes 64 px tall | 640 × 417 art px |

## Pipeline

1. `raw/codex/gen.sh` asks Codex's image tool for each sheet: two empty rooms on navy, one prop sheet and five 2×2 character sheets (idle, busy, waiting with `!`, asleep with `Zzz`) on magenta. All eight took about one minute in parallel.
2. `clean.py` (`uv run -q -w pillow -w numpy python clean.py`) crops rooms from the navy backdrop, cuts props and poses from magenta, box-downsamples to the target density, and quantizes to 48 colours. It writes `assets/<t16|t32>/` and `assets/manifest.js`.
3. `index.html` draws the room, then props and heroes Y-sorted on their foot point, at an integer scale, with HTML name plates and an HTML inspector.

Raw sheets are quantized to 256 colours before keeping them, as the notch does.

## What the prototype shows (agent observations, before the operator's verdict)

- Codex art is detailed to roughly a 32 px tile. At 16 px (B) faces, glasses, and props turn to mush; 32 px (A, C) keeps them.
- Status reads without colour through three channels: the pose (book or laptop, raised hand, sitting asleep), a glyph drawn in the art (`!`, `Zzz`), and the name plate glyph (`…`, `!`, `z`).
- Y-sorting works with a painted backdrop plus separate props: a hero behind the table is hidden by it, a hero in front covers it. Station placement must respect that.
- The 3/4 top-down props also read acceptably in the isometric room, but a production isometric theme would need props drawn for that projection.
- Name plates can overlap a neighbour's bubble when heroes stand close.
- Walking has no walk cycle yet: heroes slide with a bob.

## Verdict

Operator, 2026-10-17: 3/4 top-down, 32 px tiles, all three status channels, generated art fine for prototypes. Room composition (painted, tiled, or both) and the production pipeline stay open. The cast is a placeholder; see the ticket answer.
