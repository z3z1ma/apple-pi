Status: done
Created: 2026-10-17
Updated: 2026-10-19

# Retrospective

## What Mattered

- Settling the form with the operator first (purpose, places, art, movement, dialogue, interface) through wayfinding and fast visual prototypes, then writing one spec and 31 vertical tickets. The overnight build followed the map without a redesign.
- Front-loading all art for three themes through a repeatable pipeline (`apps/agent-world/art/`) before the UI needed it: generation took minutes per batch, and every later ticket reused it.
- Running two to four builder lanes at once with explicit file ownership, and having the root rebuild, run the combined suite, and commit after each wave. Shared files (`place-scene.ts`, `world.ts`, Electron IPC) stayed small-edit zones.
- Building integration backends against fakes while the theme packs were in progress, so the place UIs needed only a short wave once the packs landed.

## Learnings

- With a rich handoff document, agree the first-principles model with the operator before building prototypes from its details: he judged generated art and invented character roles premature and reframed the work as an abstraction over tmux and Pi.
- Design prototypes from the target experience (full-screen world, dialogue, walking), never from the notch's method: the Guild Hall prototype reused the notch's single room, pose sheets, and baked glyphs and fell far short. Agent World shares only observed state with the notch.
- Phaser 4: `this.lights` is a reserved Scene property (the lights plugin), so name such a field differently (`glows`). With HTML panels over the canvas, set `input: { windowEvents: false }`, or panel clicks also hit game objects. Phaser replays a frame's key-event queue on each new key event, so a key pressed in the same frame as another can be handled twice.
- Codex art: describe scenes on a tile grid with a person's height in tiles; spell out what to leave empty ("no seats at desks"), and for sheets say "draw no desk" explicitly, or seated frames bring furniture. Scale each sheet row on its own (Codex draws rows at different scales). Peel the magenta fringe with a padded edge test, not `np.roll`, which wraps around the image border.
- Raw generated art for three themes was about 140 MB; Pi clones the whole repository, so raw art stays local and cleaned art ships.
- Trace walk grids on a world-size render with a labelled half-tile grid, and find occlusion problems by walking the avatar just north of every blocked rect.
- A transcript can exceed V8's longest string (a 390 MB session failed with "Invalid string length"); stream JSONL line by line.
- `pi_exec` `agent_run` waits inside the program and hits its timeout; start parallel lanes with the `agent` tool in the background.

## Improvements

- The operator's own judgments were made by the root overnight and are listed in `task.md` under Morning review; the next session should start with his walkthrough and reopen tickets from it.
- Real Jira, Confluence, and Slack use, and the Slack sign-in window, are unverified until he signs in.
