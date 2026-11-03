## file

These tests exercise the batch controller's public methods and emitted progress with migrated SQLite and a Commands stand-in. Resolving the stand-in's send promise successfully means applied cleanup, while its receipt callback can publish acceptance or commitment first. Selected ancestors must wait; unrelated branches have no required relative order. Check command identities for nonempty, distinct per-person values and stable replay without requiring their spelling.
Why: Commands owns the wait for terminal runtime receipts. A premature-success fake would erase the ordering hazard; comparing unrelated request order or ID format would freeze implementation choices instead of preventing duplicate departures. Equality alone also accepts missing IDs on both runs, so presence and distinctness come first. After the held initial send settles, the replay fixture returns its terminal result rather than holding another unfinished send.

Earlier progress publications remain snapshots. A later success must not mutate an earlier update into the applied state.
Why: the test has to observe the intermediate stage after the final result exists.

Invalid input is exercised through retirePeople, not only the shape guard. Issued command payloads establish which effects were requested; the unchanged fixture database cannot prove that a hypothetical runtime move was never requested.
Why: the command stand-in does not apply database mutations. A database read can stay unchanged even when the controller emits an incorrect mutation.

Coupled: apps/agent-workplace/src/backend/departures.ts, apps/agent-workplace/src/backend/commands.ts, apps/agent-workplace/src/departures.ts
Verify: apps/agent-workplace/tests/departures.test.ts, components/session-state/tests/departure-lifecycle.test.ts
