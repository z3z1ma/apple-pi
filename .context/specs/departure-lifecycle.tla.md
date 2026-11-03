## file

Permanent departure, observed writer exit, file unlink and private-record/receipt completion are separate facts. A rejected late writer invalidates an in-flight cleanup watermark without admitting the departed person. It may also appear after an earlier truthful applied receipt, creating a new resource obligation rather than reversing that receipt.
Why: equating identity departure or a closed incarnation with OS process death could authorize unsafe deletion; asserting that an applied receipt forbids all future writers would instead invent a guarantee the runtime does not provide.

This finite safety abstraction assumes durable SQLite/handoff writes and cooperative observed producers. Stable abstract writer keys do not validate PID reuse, tmux signaling, exact file paths, private-field redaction, authorization or unobserved filesystem replacement. Logical crashes are graph cycles, not executed process/power failures. No-counterexample output is not implementation refinement or eventual-cleanup proof.

Coupled: specs/departure-lifecycle.cfg, components/session-state/src/departures.ts, components/session-state/src/runtime.ts
Verify: tests/lifecycle-models.test.ts, components/session-state/tests/departure-lifecycle.test.ts, components/session-state/tests/departures.test.ts
