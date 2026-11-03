## file

The first-load budget builds in memory with NODE_ENV=production as well as production mode. Vitest's inherited NODE_ENV=test otherwise emits React development chunks and measured 308,829 gzip bytes instead of 230,965. Restore the environment even when building fails.

The normal entry selects Workplace dynamically; that entry is included with the HTML entry, then only static imports and their CSS are followed. World, Monaco, terminal, language and worker chunks loaded later stay outside this entry-transfer budget. Each response is gzipped separately before summing, matching separate transfers rather than one combined compression stream. The build leaves committed dist untouched.

Snapshot timing covers the real openWorldBackend initial build and checks the resulting awake/dormant counts. Its scratch database is seeded before opening the query-only reader. The absent socket keeps startup synchronous and isolates projection/assembly from connection, poll scheduling and IPC latency; this is not an end-to-end UI latency bound.

Coupled: apps/agent-workplace/web/vite.config.ts, apps/agent-workplace/src/backend/world-backend.ts, tests/helpers/build-budgets.ts
Verify: apps/agent-workplace/tests/build-budgets.test.ts
