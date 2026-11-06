# 03: The capability steward brings rules and guards to sign-off

**What to build:** A `capability-steward` role and a slash command that starts a run (the operator chose an explicit command over a schedule). On each run it reads the recurring-lesson report, picks machine-detectable groups, drafts a rule or guard, proves it with replay, has a temporary advisory peer try to break it, and brings each surviving candidate as one ledger bundle with its evidence through `sign_off_task` (or `sign_off_code` for a harness change). It adopts nothing itself.

**Blocked by:** 01, 02

**Status:** done

Acceptance run by Mateo Owusu (task `work-f3ba1bd5`, `report-v2.md`); candidate `.ledger/history/202611052330-dependent-edit-batches/`, approved by the operator and merged as `9947ed34`.

- [x] The run found the batching lesson from `session_evidence` and brought a harness guard to sign-off with replay evidence and the challenger's review (`review-6447efe0`, 11 findings, all fixed).
- [x] The guard's own scan over 1,200 recorded tool batches since `eaa8e5e2` flags 59, including the 2026-11-05 edit-plus-test batches and two same-file read-and-edit batches.
- [x] The challenged candidate was revised and scanned again; the bundle records both.
- [x] Nothing changed on main before the operator's approval; the steward merged only after it.
- [x] No timer: the acceptance run was started by assignment, the same goal `/find-improvements` hands over (the command itself is covered by the loader test, not a live invocation).
