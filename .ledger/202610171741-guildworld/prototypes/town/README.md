# PROTOTYPE: the Agent World town

Throwaway prototype for [How places are built](../../decisions/15-how-places-are-built.md). It shares nothing with the notch or with the rejected Guild Hall prototype except the observed state it can load.

## Question

How are headquarters, wings, buildings, and hubs drawn, and how does the town grow with the number of sessions?

## Run

```sh
./serve.sh          # http://127.0.0.1:8765/
./snapshot.sh       # optional, inside tmux: writes live.json from the real feed (git-ignored)
```

Drag to pan, wheel to zoom (0.5×, 1×, 2×, 3×, 4×), click a place or a character to inspect it, `L` toggles evening and day, `Esc` closes the inspector. The bottom-left panel is a prototype control, not part of the design.

## What to try

1. Start: the seed resembles today's machine. `orchard-work` is the coordinator in its Guild Hall (north), `DATA-16969` works in its Work wing, `CodingHarness` is a lit cottage with two independent sessions, and `0` is a dark cottage (a tmux session with no Pi sessions).
2. Click **+ tmux session** three times, then **+ session** in two of them and **+ worker** in the others: cottages rise in the commons row south of the plaza, and the Guild Hall grows a wing per new tmux session.
3. Click **★** on an independent session to make it a coordinator: a second Guild Hall rises at the east avenue. Pick it under "workers report to" and add workers: it grows its own wings.
4. Remove a tmux session: its places fold away; add it again: it returns to the same lot. **forget lots** clears that memory.
5. **load live.json** after `./snapshot.sh` shows your real sessions.

## How it is built

- **Engine:** Phaser 4.2.1 (`vendor/phaser.min.js`, MIT, see `vendor/PHASER-LICENSE.md`); plain ES modules, no build.
- **Layout (`src/layout.js`):** a 128 × 96 tile town. The Town Square (Slack) is the plaza; the Library (Confluence) and Forge (GitHub) sit at its north corners and the Quest Board (Jira) at its south-west. Up to three coordinator districts sit at the ends of the north, east, and west avenues: the HQ faces the avenue and wings attach left and right along its street. The commons is three streets of lots south of the plaza, filled outward from the avenue.
- **Stability:** districts, wings, and lots are assigned once and remembered in `localStorage` (prototype persistence). A returning tmux session gets its old lot back while it is free.
- **Terrain (`src/terrain.js`):** grass, cobbled roads, and plaza flagstones are drawn in code, with edge variants chosen from neighbours, so roads can be laid anywhere without hand-made transition tiles.
- **Places:** whole-building sprites, not modules. Building variant comes from a hash of the tmux session name; each building brings a few props of its own. New places rise with a short animation and dust; removed ones fold down.
- **Characters:** four-direction walk cycles. Status is drawn by the engine above the head in three shapes: a dotted pill (busy), a yellow diamond with `!` that bobs (waiting), and a crescent (idle). Busy characters stand by their door with small sparks by tool kind (edit or write, bash, read); waiting characters stand at their door; idle ones stroll their street. Motion is decorative; the inspector shows the state's values.
- **Ambience:** a dusk tint plus lamp, window, and plaza glows; forge smoke.

## Art pipeline

`raw/gen.sh` asks Codex's image tool for 14 sheets in parallel (about a minute): small and medium houses, the guild hall, four wing modules, three hub buildings, the square's fountain and stalls, props, and five walk-cycle characters. `clean.py` cuts pieces from magenta, crops walk cycles to one shared frame so feet stay put, box-downsamples to the 32 px grid, and quantizes. Raw sheets are kept quantized to 256 colours.

Whole-building sprites look crafted and need no alignment, which generated tiles rarely have. The cost: a building cannot change shape with its occupants, and every theme must supply each building as a whole.

## Known gaps

- No pathfinding: a character whose home moves walks in a straight line, through buildings.
- Fixed capacity: three coordinator districts, eight wings per HQ, thirty commons lots.
- Every coordinator uses the same Guild Hall art; no per-coordinator variant.
- The plaza's tile circle has stepped edges.
- Signs are unreadable at 0.5× zoom; there is no zoomed-out label style.
- Hubs are static and empty; no interiors, no dialogue, no embodied avatar.
- Evening is a fixed tint, not a clock.

## Verdict

Pending the operator.
