# 01: Agent World opens over the real runtime

**What to build:** `/world` in a root Pi session opens the Agent World window, installing Electron on first launch. The backend in Electron's main process reads the real session-state database and streams a snapshot and updates to the world UI over the typed preload API. The UI shows the headquarters hall (prototype art for now) with one character per awake root session. This ticket also sets up the first two test seams from the spec: the backend API called in Node against a real runtime, and the built UI in headless Chrome against a fixture backend.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] `/world` opens the window; on a machine without the Electron install it is installed first and the window then opens.
- [x] Starting or stopping a root Pi session in tmux adds or removes its character within a second, in both the backend API test and the running app.
- [x] When the runtime stops, the world shows it is disconnected, and reconnects when the runtime returns.
- [x] Closing the window leaves every tmux session and Pi process unchanged.
- [x] `apps/` is in the package `files`, `tsconfig.json`, `vitest.config.ts`, and the Biome paths; the built UI is committed and a test fails when it is stale; `AGENTS.md` has an architecture-map row for it.
- [x] The backend API seam and the headless Chrome seam each run at least one passing test in `npm test`.
