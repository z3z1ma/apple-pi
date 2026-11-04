## file

One case seeds the persisted crash point: the window opened, but the daemon never recorded the returned pane id.
Why: recovery that uses only the window name misses a renamed window whose process is still running.

Successful cleanup is asserted in the test body by awaiting close/discard and checking retained ownership and files. The afterEach Promise.allSettled is best-effort isolation only; it can hide a failed close and is not evidence that cleanup worked. The explicit-runtime case also changes ambient state after selecting its socket and checks cleanup against the selected database.

The ten-peer cleanup scenario calls `runAgent` (the `temporary_peer` tool's body) with a minimal context carrying the existing coordinator transcript ROLE_ENTRY. Its caller reports to another person, so an empty transcript is correctly ineligible for peer creation; getSessionId alone also omits the role resolver's required getEntries API. Keep that eligibility premise explicit while preserving all cleanup assertions.
Why: the case is about temporary ownership and pane/task cleanup after successful peer creation, not changing authorization. Repairing the fixture must reach the cleanup path instead of bypassing the production role gate. The refusal for a non-managing caller is checked in the programs component's tests.
Coupled: components/programs/src/peers.ts, components/organization/src/session-role.ts, components/session-state/src/runtime.ts, components/session-state/src/tmux.ts
Verify: components/session-state/tests/program-peers.test.ts, components/programs/tests/programs.test.ts
