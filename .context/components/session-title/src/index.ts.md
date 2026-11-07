## file

Names are checked against every name the session-state database has recorded, and the new person's organization's current first names (from its `reports-to` flag), by reading the database directly (`namesTaken` in `components/session-state/src/peers.ts`); any failure to read it just picks a name. The origin (culture, place, pronouns) is stored in the same `session-title` entry as the name, and `sessionOrigin` reports it to the bridge only while the latest name is still the extension's own. Naming makes no model request. Naming runs for TUI and RPC people. Interns and the private BTW conversation omit this extension; passive continuations share a person's context rather than create a new person. Explicit task assignments own what a person works on.
Why: the runtime may be down or not yet started when a session starts, and naming must never wait for it or fail because of it.
Coupled: components/session-state/src/peers.ts
Verify: components/session-title/tests/session-title.test.ts

## symbol:registerSessionTitle

`state.lastAuto` is set, and the entry appended, before `pi.setSessionName(name)`: the bridge reads the origin from that entry when `setSessionName` fires `session_info_changed`.
Why: `setSessionName` fires `session_info_changed`, and that handler treats any name other than `lastAuto` as an operator rename, which stops naming for good and writes a persisted `{ stopped: true }` entry. Setting the name first would make the extension's own name look like an operator rename.
Verify: components/session-title/tests/session-title.test.ts

A recorded name whose stage is not `name` (`provisional`, `refined`, `ledger`) is a topic title from the earlier title stages, and is replaced by a human name on the next start; an operator rename still stops it.
Why: the operator's live sessions carried such titles when names became human (2026-10-19), and they should become people too without touching names he chose.
Verify: components/session-title/tests/session-title.test.ts
