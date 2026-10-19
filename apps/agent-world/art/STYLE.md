# Agent World art bible

Every painting, sprite, portrait, and overlay in Agent World follows this page, in every theme. The pipeline (`pipeline.py`) builds prompts from it and checks its output against it.

## Look

- **Medium:** polished, hand-crafted pixel art of top-tier indie RPG quality (Eastward, Sea of Stars, Octopath Traveler). Crisp pixels, no blur, no photographic texture, no painterly smudging.
- **View:** 3/4 top-down, looking down from the south. Floors are fully visible; the south wall of an interior is cut away. Every place in a theme uses the same camera angle and the same perspective.
- **Light:** warm, cozy, from inside the scene (lanterns, candles, hearths, lamps, windows at dusk in fantasy; desk lamps and monitors in tech; afternoon sun in the anime school). Light falls from the upper left; shadows fall to the lower right, soft and short.
- **Palette:** rich but cohesive. Each theme names its palette in its manifest; within a theme, a place may lean warm or cool but shares the same saturation and contrast. Scenes are quantized to 256 colours.
- **Outline:** characters, portraits, and overlays have a clean dark outline one sprite pixel wide, coloured (a dark tone of the fill), never pure black. Painted architecture has no outline.
- **No text** in any painting or sprite. Names, labels, and numbers are drawn by the game as text, so they stay readable and translatable.
- **No people** in paintings. Characters are sprites.

## Scale

- **Tile:** 48 px in the world. Place data (walk grids, spots, doors) is in tiles on a half-tile grid.
- **Character:** a standing character is 120 px tall in its sheet and drawn 1.8 tiles (about 86 px) tall in the world. Every frame stands on one baseline, so walking never jitters.
- **Scene prompts** describe the floor as a grid of squares with a person's height in squares ("30 squares wide and 20 deep, where a standing person is about 1.5 squares tall"). This keeps scale and open floor usable.
- **Portraits:** head and shoulders, 360 px tall, the same framing for every expression.

## Paintings fit the sprites

The painting is architecture and static decoration. Sprites and overlays bring everything that moves, changes, or is used.

- **No seats at work places.** A working sprite brings its own seat; a painted stool under it doubles up. Tables and desks stand free.
- **Open floor:** aisles and the floor around every table are at least a body and a half wide, so characters can reach every spot and pass each other.
- **Empty slots for overlays:** an empty hearth where an animated fire goes, a dry basin where water goes, unlit lanterns where glows go, an empty niche where a door sprite goes, an empty rod where a banner hangs, bare spots where fidget objects stand.
- **Repeatable sections:** a place that grows (the gallery) paints identical sections that the game repeats.

## Sprites and overlays

- **Character sheets:** 16 frames: walking down, up, and left in a four-phase cycle (contact, passing with one knee lifted, contact with the other leg, passing with the other knee), sitting at work seen from behind (two frames, the seat drawn), standing, and asking with one hand raised high. Walking right is walking left mirrored.
- **Portraits:** four expressions in the same framing: neutral, happy, thinking, worried.
- **Overlays:** doors (closed, open, boarded), banners, animated fire, water, glows, and fidget objects, in the same style and light as the painting they sit in.
- **Source background:** sprites are generated on flat magenta (`#FF00FF`) with wide gaps between frames, then cut with a wide colour key so no purple fringe remains.

## What good looks like

The prototype's painted hall is the floor, not the ceiling. A finished place reads at a glance (where to walk, what can be used, who is where), feels lived in, and holds up when zoomed. A finished character reads at 86 px: silhouette, colours, and pose say who it is and what it is doing before any badge does.
