## file

The `<org>` and `<manager>` texts name tools by their registered names (`list_peer_sessions`, `mailbox_send`, `start_peer_session`, `reopen_peer_session`, `close_peer_session`, `rename_peer_session`, `schedule`, `task`); renaming or removing one of those tools leaves the charter pointing at a tool the session lacks, and no test ties the two together.
Why: the charter is prose for the model, built before the tool set of the run is known, and `setSystemPromptSection` cannot check it.
Coupled: components/session-state/src/peers.ts, components/session-state/src/coordinator.ts, components/session-state/src/mail.ts, components/tasks/src/index.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/coordinator.test.ts
