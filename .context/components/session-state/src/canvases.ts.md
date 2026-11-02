## file

Canvases are the operator's own documents, stored as Markdown in the runtime so the desk and the scout read the same text he edits (native `canvases` and `canvas` tools), unlike the World's per-coordinator `NOTES.md`. Every update names the version it was read at; a different current version refuses the write and says who wrote last. Workplace autosaves against its version and, on refusal, offers "Load theirs" or "Keep mine" (re-save on the current version); an agent re-reads and redoes its change. Lists read titles and a 200-character preview, never bodies: measured on 5,000 canvases of 5.4 KB each, a page of 200 took 5 ms and a two-word search 17 ms.
Why: his typing and an agent's edit to the same canvas must never overwrite each other silently; a list that loaded bodies would grow with every page he writes.
Coupled: components/session-state/src/activity-tools.ts, apps/agent-workplace/src/backend/workplace.ts, apps/agent-workplace/web/workplace-canvases.tsx
Verify: components/session-state/tests/canvases.test.ts, apps/agent-workplace/tests/world-desk.test.ts
