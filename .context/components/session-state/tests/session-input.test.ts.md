## file

This uses a real in-process SDK session with a held extension command and zero provider requests. The host reports idle during command preparation; sealing must still fail until the public input promise settles. Reinstalling the boundary must preserve rejection and allow input again after the matching release; object identity is not part of that contract. A separate two-real-SDK-object control requires a replacement command to remain unexecuted while sealed and execute after release from the previous session. It checks SDK behavior, not ticket storage.
Why: a correct boundary may return a different adapter object or represent its ticket differently while preserving which input can run. Prompt, steer, follow-up, turn-triggering custom input and bash are rejected explicitly while sealed; stale release cannot unlock it. This does not exercise a physical CLI or OS signal.

Coupled: components/session-state/src/session-input.ts, tests/helpers/faux-session.ts
Verify: components/session-state/tests/session-input.test.ts
