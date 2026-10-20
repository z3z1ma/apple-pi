## file

`app.setPath("userData", ...)` must run before `app.requestSingleInstanceLock()`, and the scheme registration before `app` is ready.
Why: Electron keeps the single-instance lock in the userData directory; taking it first would lock the default "Electron" directory, so a `/world` with another agent directory or the default one would not find the running window.

`appDir` assumes this file runs as `dist/electron/main.js` and the preload as `dist/electron/preload.cjs`.
Why: Electron runs only the bundled output; moving the build output breaks the UI, theme, and preload paths at run time, which no test catches.
Coupled: apps/agent-world/electron.vite.config.ts, apps/agent-world/src/app-files.ts

`world:open-link` opens transcript links with `shell.openExternal` only after `openLink` in `src/backend/links.ts` accepts them (http and https, at most 8192 characters).
`world:open-file` opens a linked file with `shell.openPath` only through `openFileLink`, which shows anything that could run in Finder (`shell.showItemInFolder`) instead.
Why: the renderer shows untrusted text; the main process must not trust the renderer's own check, or a custom-scheme link could launch a local handler and a linked script or app could run.
Coupled: apps/agent-world/src/backend/links.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/links.test.ts

`AGENT_WORLD_CAPTURE` waits until `window.agentWorldView` reports a place with a painting (at most `CAPTURE_WAIT_MS`), then `CAPTURE_DELAY_MS`, writes the PNG, prints `agent-world capture: place <key>` (or `no place drew`), and quits.
Why: the start-up check (`npm run check:world-start`, apps/agent-world/scripts/startup-check.ts) reads that line and the PNG; a fixed delay captured a half-loaded window on a slow start.
Coupled: apps/agent-world/scripts/startup-check.ts, apps/agent-world/web/main.tsx
