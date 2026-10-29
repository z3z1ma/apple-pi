## file

`app.setPath("userData", ...)` must run before `app.requestSingleInstanceLock()`, and the scheme registration before `app` is ready.
Why: Electron keeps the single-instance lock in the userData directory; taking it first would lock the default "Electron" directory, so a `/world` with another agent directory or the default one would not find the running window.

`appDir` assumes this file runs as `dist/electron/main.js` and the preload as `dist/electron/preload.cjs`.
Why: Electron runs only the bundled output; moving the build output breaks the UI, theme, and preload paths at run time, which no test catches.
Coupled: apps/agent-world/electron.vite.config.ts, apps/agent-world/src/app-files.ts

`world:channel-membership` checks that the thread is a string and joined is a boolean, then sends the runtime command. It does not decide whether the thread is a channel.
Why: the renderer is untrusted, but membership authority stays in the runtime. A local allow-list here would drift from the command the socket actually applies.
Coupled: apps/agent-world/src/backend/workplace.ts, components/session-state/src/runtime.ts

`world:open-link` opens transcript links with `shell.openExternal` only after `openLink` in `src/backend/links.ts` accepts them (http and https, at most 8192 characters).
`world:open-file` opens a linked file with `shell.openPath` only through `openFileLink`, which shows anything that could run in Finder (`shell.showItemInFolder`) instead.
Why: the renderer shows untrusted text; the main process must not trust the renderer's own check, or a custom-scheme link could launch a local handler and a linked script or app could run.
Coupled: apps/agent-world/src/backend/links.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/links.test.ts

Internal workplace view links need an explicit `will-navigate` exception; permit only the app's known index URLs while other renderer navigation and new windows stay blocked. The empty query variant is deliberate: the World link's `href="?"` returns `app://world/index.html?`.
Why: browser-fixture tests bypass Electron's navigation guard and can pass even when clicking the real launch link does nothing. Broadly allowing same-origin navigation would expand the renderer's navigation authority beyond these view links.
Coupled: apps/agent-world/web/entry.ts, apps/agent-world/web/workplace.tsx
Verify: apps/agent-world/scripts/workplace-electron-check.mjs

`AGENT_WORLD_CAPTURE` waits until `window.agentWorldView` reports a place with a painting (at most `CAPTURE_WAIT_MS`), then `CAPTURE_DELAY_MS`, writes the PNG, prints `agent-world capture: place <key>` (or `no place drew`), and quits.
Why: the start-up check (`npm run check:world-start`, apps/agent-world/scripts/startup-check.ts) reads that line and the PNG; a fixed delay captured a half-loaded window on a slow start.
Coupled: apps/agent-world/scripts/startup-check.ts, apps/agent-world/web/main.tsx
