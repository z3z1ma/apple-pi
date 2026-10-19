## file

One check serves three readers: the backend (`backend/theme-packs.ts`, which reads files and decodes sheets' alpha itself), the `check-theme` CLI, and the world UI (`web/theme.ts`, over HTTP, PNG sizes from their headers). The world UI runs it with `pixels: false`: decoding every sheet in the window on each switch is slow, and a sheet off its baseline draws wrong without breaking anything. The backend's list (`themes()`) runs it with pixels.
Coupled: apps/agent-world/src/backend/theme-packs.ts, apps/agent-world/web/theme.ts, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/theme-pack.test.ts, apps/agent-world/tests/world-themes.test.ts

`TEXT_KEYS`, `STYLE_TOKENS`, and `SKIN_CLASSES` are the contract with every pack: a new key or class makes every existing pack fail the check until it supplies it, which is the point (a pack never shows a blank line or a bare widget), so add one to all three packs in the same change.
Coupled: apps/agent-world/themes/fantasy/theme.json, apps/agent-world/themes/fantasy/interface/skin.css

The baseline check reads a frame's feet as its lowest row with alpha of at least 128, one row above `baseline` (the art pipeline sets `baseline` just below the feet); the soft shadow under the feet is fainter and does not count.
