## file

A source's new items, its cursor and the triage post to the coordinator commit in one runtime transaction (`commitExternal`), then the post is dispatched; a crash cannot lose items behind an advanced cursor or post items that were not kept. A failed read records its reason and keeps the cursor. The post goes to `activity:<desk person>`, waking an on-call coordinator like other mail. Sources are read one after another, never in parallel, and a poll still running skips the next tick.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/activity.ts, roles/coordinator.md
Verify: components/session-state/tests/outside-activity.test.ts
