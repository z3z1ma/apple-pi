## file

Outside activity reads its page on demand (`readOutside`), again on every snapshot and mode change, rather than riding the snapshot: items carry excerpts, and the snapshot is sent on every change. Rows group items by conversation and show the newest, with the desk's decision or "With the desk" once delivered. Opening an item goes through `openLink`, the main process's checked link opener.
Coupled: apps/agent-workplace/src/backend/workplace.ts, apps/agent-workplace/web/workplace-desk.tsx
Verify: apps/agent-workplace/tests/world-desk.test.ts
