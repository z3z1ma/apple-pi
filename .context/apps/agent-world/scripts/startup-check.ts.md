## file

This diagnostic sets AGENT_WORLD_CAPTURE in an isolated Electron environment. The main process uses that setting to select the explicit ?world route, then reports a painted place and saves the capture before quitting. Ordinary launches without the setting open Workplace Chat instead.
Why: this check verifies the World renderer and its painting, not the app's default landing page. Changing the default must not make a Workplace screenshot count as World-render proof; the maintained workplace-electron-check owns real default-entry and round-trip navigation checks.

Coupled: apps/agent-world/src/electron/main.ts, apps/agent-world/web/entry.ts, apps/agent-world/scripts/workplace-electron-check.mjs
Verify: apps/agent-world/scripts/startup-check.ts
