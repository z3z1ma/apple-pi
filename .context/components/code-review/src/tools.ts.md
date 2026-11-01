## file

Native tools use the shared read-only projection and the runtime's existing command journal. The tool-call-derived request ID belongs to the original caller; an explicit replay handle must already name that caller's review command. A new request and exact replay have different meanings. Capture resolves a mutable target once; replay keeps that artifact even if the checkout later changes. Explicit rerun creates new work and a parent link, with no inherited coverage.

An applied receipt confirms admission or a management mutation, not completed review work. Preserve failed/uncertain receipt state separately from the journal's observed stage: an older applied record cannot turn a conflicting new request into success. Surface the recovery handle on such outcomes. An old or unavailable store fails clearly instead of restarting a production daemon or treating it as an empty queue.

Use explicit literal tuples for TypeBox unions: mapping a literal array produced a never static type even though the schema ran. The finding-response callers exposed this during typecheck.

Source browsing uses the same actor-scoped reader as the TUI. It reads retained Git objects on an explicit before/after side, with file counts or line counts before requested pages; it does not follow symlinks or substitute live files. Ordinary source tools remain available. Counts are the default for paged collections. Pass and attempt selectors intentionally expose progressively larger evidence. Original allegations, validation and raw terminal results retain their distinct meanings. The SDK test loads the real extension entrypoint on a scripted model over an isolated runtime; it is not a paid review or installed-package activation.

Waiting reads recorded job state (polling the read-only projection), not mail, so a reader who is not the owner can wait too. While waiting, and after the wait returned a generation, review-waits.ts makes the bridge record that review's milestone mail as a pointer that starts no turn; the in-process registry is lost on restart, which then delivers the full mail again (redundant, not lost).

Coupled: components/session-state/src/review-waits.ts, components/session-state/src/bridge.ts, extensions/code-review.ts, components/session-state/src/review-read.ts, components/session-state/src/review-jobs.ts, components/session-state/src/client.ts
Verify: components/session-state/tests/review-queue.test.ts
