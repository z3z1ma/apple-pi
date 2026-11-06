# 03: The capability steward brings rules and guards to sign-off

**What to build:** A `capability-steward` role and a slash command that starts a run (the operator chose an explicit command over a schedule). On each run it reads the recurring-lesson report, picks machine-detectable groups, drafts a rule or guard, proves it with replay, has a temporary advisory peer try to break it, and brings each surviving candidate as one ledger bundle with its evidence through `sign_off_task` (or `sign_off_code` for a harness change). It adopts nothing itself.

**Blocked by:** 01, 02

**Status:** planned

- [ ] Its acceptance run, unprompted, brings the batching lesson to sign-off as a guard or rule with replay evidence and the challenger's report.
- [ ] A harness-guard candidate carries its own replay over recorded tool-call batches, which finds the 2026-11-05 occurrence of an edit batched with the check that read the same file.
- [ ] A candidate the challenger breaks is either revised and replayed again or dropped, and the bundle says which.
- [ ] Nothing in `.pi/rules`, harness code or `.pi/programs` changes without the operator's sign-off.
- [ ] A run starts only from the slash command; nothing runs on a timer.
