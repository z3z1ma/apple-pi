## file

Names are checked against the other live sessions by reading the session-state database directly (`livePeers` from `components/session-state/src/peers.ts`); any failure to read it just picks a name. The stated intent reaches the session-state bridge only through `SESSION_INTENT_CHANNEL` on `pi.events`, which the bridge reports as the `intent` fact.
Why: the runtime may be down or not yet started when a session starts, and naming must never wait for it or fail because of it; the event channel keeps the two extensions independent, as the ledger's `ledger:session-linked` channel does.
Coupled: components/session-state/src/peers.ts, components/session-state/src/bridge.ts, components/shared/src/session-intent-events.ts
Verify: components/session-title/tests/session-title.test.ts, components/session-state/tests/intent.test.ts

## symbol:registerSessionTitle

`state.lastAuto` is set before `pi.setSessionName(name)`.
Why: `setSessionName` fires `session_info_changed`, and that handler treats any name other than `lastAuto` as an operator rename, which stops naming for good and writes a persisted `{ stopped: true }` entry. Setting the name first would make the extension's own name look like an operator rename.
Verify: components/session-title/tests/session-title.test.ts

A recorded name whose stage is not `name` (`provisional`, `refined`, `ledger`) is a topic title from the earlier title stages, and is replaced by a human name on the next start; an operator rename still stops it.
Why: the operator's live sessions carried such titles when names became human (2026-10-19), and they should become people too without touching names he chose.
Verify: components/session-title/tests/session-title.test.ts
