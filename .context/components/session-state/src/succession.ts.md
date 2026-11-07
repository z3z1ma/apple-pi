## file

A successor named at permanent departure takes over the departing person's conversations (operator, 2026-11-07): replacement colleagues could read the handoff file but not the mail, task and external threads it cited, and finished task threads refuse invitations. `passOnAccess` runs inside the departure commit, before cleanup deletes the departing person's participant rows. It copies each non-channel membership and each explicit channel invitation with the same delivery, following flag and read cursor, so inherited threads arrive as unread exactly where the predecessor left them, and records `successor supersedes person`. Structural channel access is left to `syncChannels`. An existing membership of the successor is kept as it is.

The successor must be a current lasting person (not retired, departing or temporary) in the departing person's organization; checked at acceptance and again at commit through `departureCandidate`.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts
