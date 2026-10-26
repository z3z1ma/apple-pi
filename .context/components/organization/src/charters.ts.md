## file

The `<org>` and `<manager>` texts name tools by their registered names (`directory`, `send_mail`, `reply`, `inbox`, `read_thread`, `post`, `hire`, `rehire`, `send_home`, `rename`, `remind_me`, `task`, `link`); renaming or removing one of those tools leaves the charter pointing at a tool the session lacks, and no test ties the two together.
Why: the charter is prose for the model, built before the tool set of the run is known, and `setSystemPromptSection` cannot check it.
Standups compose the existing reminder and meeting tools. Their cadence stays the manager's judgment; the charter is an option, not a second scheduling engine.
Coupled: components/session-state/src/peers.ts, components/session-state/src/coordinator.ts, components/session-state/src/mail.ts, components/tasks/src/index.ts, components/session-state/src/work-tools.ts
Verify: components/organization/tests/roles.test.ts, components/session-state/tests/coordinator.test.ts
