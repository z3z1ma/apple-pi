## file

The ledger stage reads `ledger_add`'s `title` argument and the `taskPath`/`status` fields of the tool result `details` from `extensions/ledger.ts`; `ledger_status` titles come from the H1 of `<cwd>/<taskPath>`.
Why: the ledger extension belongs to another lane and exposes no event for task changes, so this extension watches `tool_result` instead. If those details fields are renamed, the ledger retitle silently stops.
Coupled: extensions/ledger.ts
Verify: components/session-title/tests/session-title.test.ts

## symbol:registerSessionTitle

`state.lastAuto` is set before `pi.setSessionName(title)`.
Why: `setSessionName` fires `session_info_changed`, and that handler treats any name other than `lastAuto` as an operator rename, which stops titling for good and writes a persisted `{ stopped: true }` entry. Setting the name first would make the extension's own title look like an operator rename.
Verify: components/session-title/tests/session-title.test.ts
