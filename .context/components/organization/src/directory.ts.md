## symbol:roleColumn

Every read of `sessions.role` by extension code goes through this guard (`organizationOf` here, `livePeers` in `peers.ts`); a reader that names `s.role` directly throws `no such column` in a session whose bridge connected to a runtime older than the migration.
Why: the runtime daemon migrates the schema only when it starts and keeps running across checkout changes, so a root session of newer code can read a database the older runtime still serves (the operator's runtime of 2026-10-19 lacked the column while this code was live from the checkout).
Coupled: components/session-state/src/peers.ts, components/session-state/src/schema.ts
Verify: components/organization/tests/roles.test.ts

## symbol:organizationOf

Reads the state database read-only and derives the tree from `reports_to` on every call; a session whose manager is not in the `sessions` table is treated as a root of its own.
Why: the runtime is the only writer, and a tree stored beside the rows would need a second migration path for transfers and retirements; a dangling manager id (a deleted database, a manager that never connected) must not hide the session from every directory.

Membership includes asleep sessions (no live incarnation), unlike `livePeers` in `components/session-state/src/peers.ts`, which lists only awake sessions machine-wide for name uniqueness and `/pi-sessions`.
Why: a person who is closed still exists in the organization and reopens with its history; the directory is how a manager finds whom to reopen.
Coupled: components/session-state/src/peers.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/peers.test.ts
