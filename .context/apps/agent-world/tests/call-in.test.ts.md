## file

This suite exercises the public lifecycle callIn method over an isolated migrated SQLite database and a Commands stand-in that records accepted/applied/failed starts and incarnations. operatorPane is stubbed; no Pi process, tmux server, browser or live runtime starts. Assertions cover ordinary start payloads and no replacement goal/prompt, not native transcript restoration or real OS liveness.
Why: the Commands stand-in never creates tasks, so an empty work_tasks table cannot independently prove the no-new-task requirement; the outgoing payload assertion carries that proof. The coalescing contract is one launch sequence and consistent results for callers, not JavaScript Promise object identity.

The accepted/delivered cases advance the existing lifecycle wait with fake timers: an ok receipt before connection remains uncertain, blocks reports and survives controller recreation without another start. Applied-without-incarnation is separately refused. A missing journal outcome retries the same command identity; a known failed attempt gets a new one. A completed operation followed by a later stop requires a new explicit action.

The final-liveness case first failed with ok:true after the head stopped during leaf startup. Its result must now preserve the head's applied receipt while reporting uncertainty, leaving the actually connected leaf ready. Another case confirms traversal continues above an awake intermediate manager. The original World wake is exercised separately and still starts only its selected sleeper while ancestors stay asleep.

Fixture inserts use the real migrated schema: event timestamps are `at`, not `ts`. Temporary ancestry setup must succeed before the refusal assertion means anything. These tests do not establish native IPC forwarding, preview/dialog behavior or daemon process launch behavior.
Coupled: apps/agent-world/src/call-in.ts, apps/agent-world/src/backend/call-in.ts, apps/agent-world/src/backend/lifecycle.ts, components/session-state/src/schema.ts
Verify: apps/agent-world/tests/call-in.test.ts
