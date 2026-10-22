## file

BTW borrows the parent's selected model runtime, not its tools, role, notebook, or session state. `ModelRegistry.runtime` is the current SDK's private facade seam; capture it and the selected mind before asynchronous loading, and fail visibly if unavailable. Disposing BTW must leave that shared runtime usable by the parent. Only the three explicit safety/fast-mode extensions load.

Pi's current `getSessionStats()` reads all session entries, including compaction usage. It supplies lifetime totals directly; the former subagent accumulator's claim that SDK statistics reset at compaction is obsolete. The UI excludes cache-read tokens from its cumulative token label.

Dismissing a view only unsubscribes it. A first question becomes accepted at the native `agent_start`, not when `prompt()` is called: an earlier authentication/preparation failure must leave the parent's snapshot cursor untouched. Stop aborts both before and after acceptance, then awaits the run. The first abort reaches preflight compaction; the second reaches a prompt that was still preparing when the first abort saw an idle session. Close also emits extension shutdown and disposes exactly once. Explicit change listeners cover preflight failures, which can occur before any native session event reaches the view.

Coupled: components/btw/src/index.ts, components/btw/src/ui/viewer.ts, docs/btw.md
Verify: components/btw/tests/session.test.ts, components/btw/tests/viewer.test.ts
