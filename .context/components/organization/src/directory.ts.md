## symbol:organizationColumns

Every read of `sessions.role`, `sessions.soul`, or `sessions.self` by extension code goes through this guard (`organizationOf` here, `livePeers` in `peers.ts`); a reader that names `s.role` directly throws `no such column` in a session whose bridge connected to a runtime older than the migration.
Why: the runtime daemon migrates the schema only when it starts and keeps running across checkout changes, so a root session of newer code can read a database the older runtime still serves (the operator's runtime of 2026-10-19 lacked the column while this code was live from the checkout).
Coupled: components/session-state/src/peers.ts, components/session-state/src/schema.ts
Verify: components/organization/tests/roles.test.ts

## symbol:reportingOf

Read the current runtime-owned relationship for both prompt identity and mail addressing. Launch flags seed placement but stay stale after a transfer. Preserve three states: a parent id, null for a recorded root, and undefined when the database/person is missing. Only the recorded root supports the unroled management exception; organizationOf's directory fallback is not an authorization fact.
Why: a real move updated mail and the runtime tree while the old flag kept the prompt naming the prior manager. The transfer test checks the immediate prompt, reconnect with the stale flag, and the unchanged prior provider-request prefix plus an appended section delta.
Coupled: components/organization/src/install.ts, components/session-state/src/addresses.ts
Verify: components/session-state/tests/organization.test.ts, components/organization/tests/roles.test.ts

## symbol:specializationOf

This reader is query-only and uses organizationColumns before selecting specialization, so a newly loaded extension can still prompt against a pre-migration daemon. Absence is null; it never reconstructs focus from historic commands, role names, or transcripts. Runtime creation is the only writer.
Coupled: components/organization/src/install.ts, components/session-state/src/runtime.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/specialization.test.ts

## symbol:organizationOf

Reads the state database read-only and derives the tree from `reports_to` on every call; a session whose manager is not in the `sessions` table is treated as a root of its own.
Why: the runtime is the only writer, and a tree stored beside the rows would need a second migration path for transfers and retirements; a dangling manager id (a deleted database, a manager that never connected) must not hide the session from every directory.

Membership includes asleep sessions (no live incarnation), unlike `livePeers` in `components/session-state/src/peers.ts`, which lists only awake sessions machine-wide for name uniqueness and `/pi-sessions`.
Why: a person who is closed still exists in the organization and reopens with its history; the directory is how a manager finds whom to reopen.
Coupled: components/session-state/src/peers.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/peers.test.ts
