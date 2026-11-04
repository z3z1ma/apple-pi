## file

`temporary_peer` and `colleague` have `codemode` exposure: never declared to the model, callable from codemode scripts and saved programs. Because codemode-exposed tools stay callable whatever the active set, posture cannot hide them; each call checks `managesPeople` (a managing role or an unroled recorded root) before opening a runtime program or launching anyone.
Why: a capability gate that lives only in tool activation would let any script reach peer creation.

Each call opens one runtime peer program and closes it in `finally`. Closing the program discards a temporary peer it started (record deleted, transcript kept) and never touches an attached colleague's process; the runtime, not this module, owns those processes. Bound `context` is written beside the person's focused task, so task cleanup owns its lifetime.
Coupled: components/session-state/src/program-client.ts, components/session-state/src/program-peers.ts, components/organization/src/install.ts
Verify: components/session-state/tests/program-peers.test.ts, components/programs/tests/programs.test.ts
