## file

Exercise the public task-control CLI with synthetic transcript files and inspect its retained report, rather than checking internal projection arrays. The two people deliberately share a local entry ID while each has an older message outside the task interval and a later message beyond the frozen cutoff. Check source attribution and original per-person ordinals without fixing relevance-rank tie order.
Why: a comparison can return plausible text while joining the wrong person's source, renumbering historical addresses, or searching a different corpus. Positive historical recovery and unchanged source bytes make the exclusion checks meaningful.

Reject a changed frozen prefix or a task-manifest mismatch before producing a report. These are evaluation-integrity checks, not tests of production task authorization. The standalone SQLite corpus-statistics observation belongs to the recorded method limits rather than a regression contract for this CLI.
Why: the control cannot establish access rights, and pinning a dependency's incidental ranking behavior would not catch a broken task-control surface.

CLI fixtures use the documented /tmp output location rather than the host's os.tmpdir().
Why: macOS resolves the latter under /var/folders, outside this evaluation CLI's accepted output path; otherwise rejection tests stop at argument validation instead of exercising corpus validation.

Coupled: .ledger/202611021905-task-scoped-recall/task-control.mjs, .ledger/202611021905-task-scoped-recall/recall-gate.md
Verify: .ledger/202611021905-task-scoped-recall/task-control.test.mjs
