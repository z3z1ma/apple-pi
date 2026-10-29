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

Recruit IPC accepts an omitted brief or a string, refusing other supplied types; its explicit field forwarding keeps absent initial work intact. It explicitly forwards its allowed fields, including string specialization; adding a creation-request DTO field also requires adding it to this handler. The browser fixtures supply agentWorld directly and cannot prove main-process forwarding. Malformed optional specialization is not forwarded; runtime creation remains the persistence authority.
Why: a valid renderer request can otherwise lose creation context at the Electron boundary while its UI and backend tests both pass.
Coupled: apps/agent-world/src/world.ts, apps/agent-world/src/backend/lifecycle.ts
The lifecycle tests verify the request after this handler; they do not exercise this forwarding step.

Org IPC validates renderer payload shapes through the public Org guards before calling the standalone controller; it shares the existing Commands connection with lifecycle/workplace actions. Shape validity is not an allowed-key filter: the controller extracts the authorized move fields rather than spreading a renderer object into a runtime command. Progress is emitted on world:org-progress, and listener disposal in the preload removes its own forwarder.
Why: a well-typed renderer object can still contain an unexpected command kind. Shape validation alone must not turn those extra fields into runtime authority.
Coupled: apps/agent-world/src/org.ts, apps/agent-world/src/backend/org.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/org-api.test.ts, apps/agent-world/tests/org-backend.test.ts

Internal view links need an explicit `will-navigate` exception; permit only the app's exact index, empty-query, ?world, Chat, Mail, Org, Code and Issues URLs while other renderer navigation and new windows stay blocked. Bare and empty-query entries open Workplace Chat; the standalone diagnostic World route is exactly ?world. The World rail control selects ?workplace=world within the existing Workplace document and mounts the same-origin ?world&embedded=1 iframe. The main frame is that parent Workplace document; selecting this tab needs no new main-frame navigation exception. Ordinary Electron startup loads the bare URL.
Why: browser-fixture tests bypass Electron's navigation guard and can pass even when clicking the real launch link does nothing. Broadly allowing same-origin navigation would expand the renderer's navigation authority beyond these view links.
The embedded entry reuses the parent's preload API before loading World. Validate that reuse in actual Electron: a child call must retain the parent's IPC identity while the existing main-frame guard remains unchanged. Browser fixtures replace the API and cannot prove this boundary.
Coupled: apps/agent-world/web/entry.ts, apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-world.tsx, apps/agent-world/src/electron/terminal-ipc.ts
Verify: apps/agent-world/scripts/workplace-electron-check.mjs

world:call-in validates the explicit request shape and delegates to lifecycle's recorded-chain checks. It stays separate from world:wake, whose original World semantics call only the selected sleeper. Renderer confirmation is not authority to start additional people beyond the confirmed ids.
Coupled: apps/agent-world/src/call-in.ts, apps/agent-world/src/backend/call-in.ts, apps/agent-world/src/backend/lifecycle.ts
Verify: apps/agent-world/tests/call-in.test.ts

workspace:resolve-paths validates the candidate list/source cwd and explicitly forwards only those fields. It belongs to the workspace API, independent of the currently selected Code root; backend path validation remains authoritative. The preload uses this same channel, not the world-prefixed lifecycle collection.
Coupled: apps/agent-world/src/workspace.ts, apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts

Workspace IPC validates payload shapes before filesystem operations; it intentionally accepts manual directory roots for the operator's Code editor. This authority is separate from transcript link opening. Only save-file writes and requires an existing file plus its base hash; Git endpoints are read-only.
Why: editor-selected roots intentionally grant broader local filesystem access than links embedded in untrusted conversation content, so the two entry paths must retain separate validation rules.
Coupled: apps/agent-world/src/workspace.ts, apps/agent-world/src/backend/workspace.ts, apps/agent-world/src/electron/preload.ts
Verify: apps/agent-world/tests/workspace-backend.test.ts

The shared renderer beforeunload guard aggregates dirty drafts and starting/running embedded-terminal counts, triggering Electron's will-prevent-unload native confirmation. Stay is both default and cancel. In this Electron event, preventDefault permits unloading by overriding the renderer veto, so it runs only for explicit Leave. Actual full-page navigation or reload uses this once rather than another window.confirm first. Selecting the retained World tab changes the visible application within the same document, so it neither unloads the renderer nor asks for this confirmation.
Why: Electron's event cancels the renderer's cancellation; reversing that meaning would discard edits on Stay, while omitting the handler can trap the operator in a page that always vetoes unloading.
Embedded terminals are main-process resources for the current renderer. Close them on committed main-frame did-frame-navigate, renderer death, actual window close and application disposal, not on will-navigate or an attempted unload. This preserves shells when Stay cancels navigation while avoiding unowned shells after full reload or a standalone full-page route change. Same-document tab switches and child-frame World navigation preserve renderer-owned shells; the main-frame condition remains essential.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/src/electron/electron.d.ts, apps/agent-world/src/electron/terminal-ipc.ts, apps/agent-world/src/backend/embedded-terminal.ts

The diagnostic-only `AGENT_WORLD_CAPTURE` launch explicitly loads ?world, preserving the existing World-render check while ordinary startup stays in Workplace. It waits until `window.agentWorldView` reports a place with a painting (at most `CAPTURE_WAIT_MS`), then `CAPTURE_DELAY_MS`, writes the PNG, prints `agent-world capture: place <key>` (or `no place drew`), and quits.
Why: the start-up check (`npm run check:world-start`, apps/agent-world/scripts/startup-check.ts) reads that line and the PNG; a fixed delay captured a half-loaded window on a slow start.
Coupled: apps/agent-world/scripts/startup-check.ts, apps/agent-world/web/main.tsx
