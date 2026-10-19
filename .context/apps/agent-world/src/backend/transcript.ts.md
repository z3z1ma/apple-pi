## file

`MAIL` and `MAIN_ARGS` copy `MAIL_CUSTOM_TYPE` from `components/session-state/src/mail.ts` and `MAIN_ARGS` from its `bridge.ts`, not imports.
Why: both modules import Pi's runtime packages, which must not enter Electron's main-process bundle; a change there must be repeated here, or mail renders as a note and tool lines show a different argument than the sidebar.
Coupled: components/session-state/src/mail.ts, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/conversation.test.ts

Every text field is cut at `TRANSCRIPT_TEXT_MAX` with `cut` set on tool results.
Why: a page of 50 entries crosses IPC whole; tool outputs and file reads in real sessions reach megabytes.
