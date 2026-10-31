## file

Native tools use the shared read-only projection and the runtime's existing command journal. The tool-call-derived request ID belongs to the original caller; an explicit replay handle must already name that caller's review command. A new request and exact replay have different meanings. Capture resolves a mutable target once; replay keeps that artifact even if the checkout later changes. Explicit rerun creates new work and a parent link, with no inherited coverage.

An applied receipt confirms admission or a management mutation, not completed review work. Preserve failed/uncertain receipt state separately from the journal's observed stage: an older applied record cannot turn a conflicting new request into success. Surface the recovery handle on such outcomes. An old or unavailable store fails clearly instead of restarting a production daemon or treating it as an empty queue.

Use explicit literal tuples for TypeBox unions: mapping a literal array produced a never static type even though the schema ran. The finding-response callers exposed this during typecheck.

Counts are the default for paged collections. Pass and attempt selectors intentionally expose progressively larger evidence. Original allegations, validation and raw terminal results retain their distinct meanings. The SDK test loads the real extension entrypoint on a scripted model over an isolated runtime; it is not a paid review or installed-package activation.

Coupled: extensions/code-review.ts, components/session-state/src/review-read.ts, components/session-state/src/review-jobs.ts, components/session-state/src/client.ts
Verify: components/session-state/tests/review-queue.test.ts
