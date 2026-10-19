Status: pending
Created: 2026-10-17
Updated: 2026-10-17

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- With a rich handoff document, agree the first-principles model with the operator before building prototypes from its details: he judged generated art and invented character roles premature and reframed the work as an abstraction over tmux and Pi.
- Design prototypes from the target experience (full-screen world, dialogue, walking), never from the notch's method: the Guild Hall prototype reused the notch's single room, pose sheets, and baked glyphs and fell far short. Agent World shares only observed state with the notch.
- Phaser 4: `this.lights` is a reserved Scene property (the lights plugin), so name such a field differently (`glows`). With HTML panels over the canvas, set `input: { windowEvents: false }`, or panel clicks also hit game objects.
- Codex scene art: describing the room on a tile grid with a person's height in tiles gave usable scale and open floor; it honours landscape 3:2 and 2:1 (1536x1024, 1774x887). Quantizing to 256 colours (PIL MEDIANCUT with Floyd-Steinberg) cut about 2.8 MB to 1 MB with no visible loss. Cut sprites off magenta with a wide key (r, b > 140 and g < 0.62 * min(r, b)), or a purple fringe stays.
- Walk grids traced by eye over a thumbnail made rooms impassable. Render the painting at world size with a labelled half-tile grid overlay (Pillow), read it in halves, trace fractional-tile rects tightly around furniture, and verify with the in-app walk-grid toggle.

## Improvements

Pending completion of the undertaking.
