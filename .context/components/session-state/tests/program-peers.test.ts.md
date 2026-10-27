## file

The ten-agent cleanup scenario calls createPeerCalls with a minimal context carrying the existing coordinator transcript ROLE_ENTRY. Its caller reports to another person, so an empty transcript is correctly ineligible for native peer creation; getSessionId alone also omits the role resolver's required getEntries API. Keep that eligibility premise explicit while preserving all cleanup assertions.
Why: the case is about temporary ownership and pane/task cleanup after successful native peer creation, not changing authorization. Repairing the fixture must reach the cleanup path instead of bypassing the production role gate. Actual loader/role authorization belongs to the separate work-panel integration test; the other wire-level kernel fixtures here are not that proof.
Coupled: components/pi-exec/src/peer-calls.ts, components/organization/src/session-role.ts, components/session-state/src/runtime.ts, components/session-state/src/tmux.ts
Verify: components/session-state/tests/program-peers.test.ts, tests/pi-exec-work-panel.test.ts
