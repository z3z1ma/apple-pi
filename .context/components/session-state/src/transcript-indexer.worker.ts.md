## file

This worker is the transcript index's only writer. Each message names a session and its transcript file. The worker updates that session's rows, one session at a time, and coalesces repeated requests for a session that is already waiting.
Why: two writers, or two updates of the same session at once, would race the index rows.

The runtime starts this file as a `.ts` worker (`new Worker(new URL(..., import.meta.url), { workerData })`); it runs because a worker inherits the runtime's `--import register.mjs` execArgv, so it is held to the same erasable-syntax-only TypeScript. node:sqlite ships FTS5 (porter unicode61, bm25, snippet), so the index needs no native dependency.
Coupled: components/session-state/src/transcript-index.hot.ts
Verify: components/session-state/tests/transcript-index.test.ts
