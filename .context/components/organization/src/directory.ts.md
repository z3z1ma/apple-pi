## symbol:organizationOf

Reads the state database read-only and derives the tree from `reports_to` on every call; a session whose manager is not in the `sessions` table is treated as a root of its own.
Why: the runtime is the only writer, and a tree stored beside the rows would need a second migration path for transfers and retirements; a dangling manager id (a deleted database, a manager that never connected) must not hide the session from every directory.

Membership includes asleep sessions (no live incarnation), unlike `livePeers` in `components/session-state/src/peers.ts`, which lists only awake sessions machine-wide for name uniqueness and `/pi-sessions`.
Why: a person who is closed still exists in the organization and reopens with its history; the directory is how a manager finds whom to reopen.
Coupled: components/session-state/src/peers.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/peers.test.ts
