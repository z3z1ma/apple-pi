## file

The cursor is built from the pack's PNGs in a canvas (data URLs at 1x and 2x in an `image-set`), because the sprites are about 250 to 330 px and Chrome ignores a cursor image over 128 px, falling back to the keyword after the comma. The 1x hotspot is in CSS px of the 1x image. Until a pack's cursors are built, or when its sprites fail to load, the cursor is the system `pointer` hand, never the arrow. Reading the sprites' pixels needs them same-origin: Electron serves the app and packs from the privileged `app://` scheme, the tests from one origin.
Why: ticket 01 of `.ledger/202610191114-agent-world-alive/` (no default arrow over the world, the hand's fingertip as the hotspot).
Coupled: apps/agent-world/themes/README.md, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/world-pointer.test.ts

## symbol:fingertip

The hotspot is the top-left-most pixel of the sprite's largest opaque shape (alpha at least 128), which assumes every pack's hand points up and to the left; the sparkles beside the tapping hand are separate shapes and do not count. A pack whose hand points another way needs its hotspot stated in the pack instead.
