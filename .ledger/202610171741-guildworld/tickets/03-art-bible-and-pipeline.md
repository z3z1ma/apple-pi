# 03: Art bible and art pipeline

**What to build:** Agent World's look is written down and its art is made the same way every time. The art bible covers palette, light direction, outline weight, tile size, character scale, and the rule that paintings fit sprites: no seats at work places, open floor and aisles, empty slots for overlays. Repeatable tooling generates a scene or a sheet with Codex from a prompt template, cuts sprites off magenta without fringe, quantizes, normalises sheet size and baseline, and writes cleaned art beside the raw art. Raw art stays in the repository; cleaned art ships.

**Blocked by:** 01 Agent World opens over the real runtime

**Status:** ready-for-agent

- [ ] Running the tooling on a scene prompt and a sheet prompt produces cleaned assets with no magenta or purple pixels at sprite edges and every frame on one baseline.
- [ ] The prompt templates state the tile grid and a person's height in tiles for scenes, and each frame's pose and walk phase for sheets.
- [ ] The art bible is in the repository and the operator agrees it describes the look he wants.
