## file

Use the same structural-event vocabulary as the membership/ownership replay when cutting waiting and execution intervals. Assignment ends are exclusive for snapshots and durations, while a close event can include the assignment ending at that instant. The caller captures one cutoff; paging remains observational rather than a saved database snapshot.
Why: checking membership only at the period endpoint can charge time across a reporting move, and exclusive snapshot rules applied to a closure can hide the work from its finishing holder.

Historical focus comes from committed work-change/task-post pairs; the post supplies the timestamp absent from work_changes. Repeated focus on the same task is not a transition. Preserve the work producer's atomic pairing when changing either side; erased internal work remains unavailable.
Why: command acceptance, current work_focus and arbitrary nearby messages cannot reconstruct when a focus change committed.
Coupled: components/session-state/src/fitness.ts, components/session-state/src/work.ts, components/session-state/src/work-inspection.ts, components/session-state/src/execution-inspection.ts
Verify: components/session-state/tests/work-inspection.test.ts, components/session-state/tests/work.test.ts, components/session-state/tests/execution-inspection.test.ts
