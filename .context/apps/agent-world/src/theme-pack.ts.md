## file

One check serves three readers: the backend (`backend/theme-packs.ts`, which reads files and decodes sheets' alpha itself), the `check-theme` CLI, and the world UI (`web/theme.ts`, over HTTP, PNG sizes from their headers). The world UI runs it with `pixels: false`: decoding every sheet in the window on each switch is slow, and a sheet off its baseline draws wrong without breaking anything. The backend's list (`themes()`) runs it with pixels.
Coupled: apps/agent-world/src/backend/theme-packs.ts, apps/agent-world/web/theme.ts, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/theme-pack.test.ts, apps/agent-world/tests/world-themes.test.ts

`TEXT_KEYS`, `STYLE_TOKENS`, and `SKIN_CLASSES` are the contract with every pack: a new key or class makes every existing pack fail the check until it supplies it, which is the point (a pack never shows a blank line or a bare widget), so add one to all three packs in the same change.
Coupled: apps/agent-world/themes/fantasy/theme.json, apps/agent-world/themes/fantasy/interface/skin.css

The baseline check reads a frame's feet as its lowest row with alpha of at least 128, one row above `baseline` (the art pipeline sets `baseline` just below the feet); the soft shadow under the feet is fainter and does not count.

`--aw-icon-<tab>` tokens (`TAB_ICONS`) are optional, unlike `STYLE_TOKENS`: a pack may give any tab its own icon as `url(<svg>)` (drawn as a mask in the text colour by the side panel's `TabIcon`), and a tab without one keeps the built-in neutral icon. The check rejects an unknown tab name or a non-SVG and, like every url token, a missing file.
Coupled: apps/agent-world/web/overlay/interface/side-panel.tsx, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/theme-pack.test.ts, apps/agent-world/tests/world-themes.test.ts

Idle sheets (`Look.idle`) and points of interest (`PlaceData.interest`) are optional but checked when present. The check keeps interest points clear of doors' stand points, entries, spots, the host, and the recruiter, but not of floor fidgets (the check does not import `fidget-spots.ts`); `life-pack.test.ts` holds every real pack to that too.
Why: a wanderer paused on a doorstep or on a cat would block a door or stand inside something; the fidget clearance lives in the test to keep the pack check free of the scene's fidget rules.
Coupled: apps/agent-world/web/game/wander.ts, apps/agent-world/web/game/boot-scene.ts
Verify: apps/agent-world/tests/life-pack.test.ts

## symbol:checkPets

Pets are counted by place file: at most one per file (a `sleeper` counts), and no look in two files. A file the world shows several times (each coordinator's headquarters and common room, every wing) would still show its pet in each copy, which the check cannot see; the built-in packs keep pets out of those rooms (themes/README.md says so). `slotStyle` gives a look its own `frames` and never the kind's, whose frames describe `pet-0..3` only.
Coupled: apps/agent-world/themes/README.md, apps/agent-world/web/game/fidgets.ts
Verify: apps/agent-world/tests/pets.test.ts
