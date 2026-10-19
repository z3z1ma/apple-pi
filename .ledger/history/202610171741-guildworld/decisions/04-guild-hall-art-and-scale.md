Type: prototype
Status: resolved
Blocked by: 

# Guild Hall art and scale

## Question

What tile scale, camera angle, and asset pipeline produce the storybook feel of the approved concept (`../source/approved-storybook-concept.png`) with readable characters and status?

Build one rough Guild Hall room as a plain web page with mock agents in `busy`, `idle`, and `waiting`, comparing 16 px and 32 px tiles in a 3/4 top-down view, Y-sorted actors, and integer scaling. Decide whether art is generated and cleaned like the notch pipeline (`components/tmux-sessions/notch/art/`) or hand-made, and how status reads without colour alone. The user judges the feel.

## Answer

Prototype: [prototypes/guild-hall/](../prototypes/guild-hall/README.md). Operator's verdict, 2026-10-17.

- **Camera:** 3/4 top-down for rooms. Isometric was also liked and is not ruled out for a later theme or layout.
- **Density:** 32 px tiles, with heroes about 64 px tall. That matches the detail Codex produces; at 16 px it turns to mush.
- **Status without colour:** keep all three channels: pose, a glyph drawn in the art (`!`, `Zzz`), and the glyph on the name plate. (Superseded in part by the later verdict below: glyphs are no longer baked into the art.)
- **Art generation:** Codex-generated art, cleaned by script, is fine for prototyping. The operator judged that this ticket committed to asset generation too early, so the production pipeline is not decided.
- **Not decided, moved to fog:** whether rooms and the town are one-shot painted interiors, tile-based, or a combination.
- **Caveat:** the prototype's cast (Sage, Artificer, Sentinel, Scribe) is invented. Only the coordinator (the session that runs the `coordinator` skill; the Guildmaster in the fantasy theme) has operator backing. The operator's first-principles framing that followed is in the map's Notes and reframes [What Agent World abstracts in tmux and Pi](05-world-ontology-and-truth.md).
- **Later verdict (operator, 2026-10-18):** the prototype copied the notch's method and fell far short of the direction. The camera (3/4 top-down) and density (32 px) choices stand; the method (one painted room, pose sheets, baked glyphs) does not carry forward.
