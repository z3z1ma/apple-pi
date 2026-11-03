## file

Spans are written by triggers on `work_focus` (schema.ts migration 51), not by the code paths that change focus, so take, assign, focus, finish, unassign, close, departures and program-peer cleanup all record them. A new path that changes focus needs no span code; one that bypasses `work_focus` records nothing. `reconstructSpans` runs only while the table is empty and marks its rows `reconstructed`; gaps in retained work changes stay gaps.
Why: focus history was only replayable from work changes joined to their task posts, and that replay missed `close`.

A span means "written while focused on this task", not "about this task". Access is the operator's decision (2026-11-02): people ever assigned to the task or with a span on it, managers above them in today's tree, and the operator. `mayReadEntry` applies the same rule to a single entry: another person's entry is readable only inside a span of a task the reader may search; an entry with no indexed time cannot be placed and is refused.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/focus-spans.test.ts
