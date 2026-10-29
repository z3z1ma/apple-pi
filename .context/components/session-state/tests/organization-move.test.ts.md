## file

Focused work belongs to a real held assignment in its task's organization. Exercise focus preservation when the whole recorded organization head moves with the assignee; a partial move must instead refuse that unfinished work.
Why: a focus row pointing to a nonexistent task passed the old preservation assertion without proving any usable work survived. Moving a whole organization is the valid case where an unfinished assignment and its focus should stay unchanged.

Hidden temporary descendants are excluded from the operator's expected branch but remain in ancestry and assignment-safety checks. The temporary fixture uses a durable creation fact without a live launch row, so the test also exercises identity retained beyond launch cleanup.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/program-peers.ts, components/session-state/src/work.ts
Verify: components/session-state/tests/organization-move.test.ts
