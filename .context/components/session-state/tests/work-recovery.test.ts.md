## file

The historical-finish fixture seeds a committed archive destination and an outstanding old source-cleanup receipt before starting the isolated runtime. Keep source-only evidence distinct from the archived outcome and assert both remain readable after startup. The current finish API cannot generate this old state; seeding persisted recovery records is deliberate, while file preservation is the observable assertion rather than how the receipt is cleared.
Why: changing new finishes alone leaves pre-upgrade cleanup receipts able to erase original artifact paths on restart, including evidence written after the archive copy. Failed completion separately preserves the original goal and evidence through the public command socket.
Coupled: components/session-state/src/work.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/work-recovery.test.ts
