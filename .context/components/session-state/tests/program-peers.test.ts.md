## file

One case seeds the persisted crash point: the window opened, but the daemon never recorded the returned pane id.
Why: recovery that uses only the window name misses a renamed window whose process is still running.

Successful cleanup is asserted in the test body by awaiting close/discard and checking retained ownership and files. The afterEach Promise.allSettled is best-effort isolation only; it can hide a failed close and is not evidence that cleanup worked. The explicit-runtime case also changes ambient state after selecting its socket and checks cleanup against the selected database.

The ten-agent cleanup scenario calls createPeerCalls with a minimal context carrying the existing coordinator transcript ROLE_ENTRY. Its caller reports to another person, so an empty transcript is correctly ineligible for native peer creation; getSessionId alone also omits the role resolver's required getEntries API. Keep that eligibility premise explicit while preserving all cleanup assertions.
Why: the case is about temporary ownership and pane/task cleanup after successful native peer creation, not changing authorization. Repairing the fixture must reach the cleanup path instead of bypassing the production role gate. Actual loader/role authorization belongs to the separate Pi Exec integration test; the other wire-level kernel fixtures here are not that proof.
Coupled: components/pi-exec/src/peer-calls.ts, components/organization/src/session-role.ts, components/session-state/src/runtime.ts, components/session-state/src/tmux.ts
Verify: components/session-state/tests/program-peers.test.ts, tests/pi-exec-integration.test.ts
