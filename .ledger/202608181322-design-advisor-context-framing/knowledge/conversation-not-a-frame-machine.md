Status: active
Created: 2026-08-18
Updated: 2026-08-18

# The advisor is a regular session; two things change

"Context framing" is the wrong picture. The advisor is an ordinary accumulating conversation. We do not rebuild a structured prompt on every drain. We do not keep a private token budget.

Two changes:

1. Deltas are a trajectory projection. Thinking, text, calls, args, exit stay. Observation and command results become tool-specific receipts. Edit diffs stay whole. See `decisions/observation-receipts.md`.
2. When Pi would compact this session, the `session_before_compact` handler reseeds: live curator fold, last few user messages, rolling notes. It does not summarize. It is not VCC.

Everything else is a normal session. User text appends as quoted primary transcript (user → implementing agent), not as a message to the advisor. Recall dies with compact. Curator writes do nothing. Identity change is still `reset()`. `#softReset` / `ADVISOR_COMPACT_AT` / a 96k drain check / `transformContext`-as-reseed are the machines we are not building.

The numbered prompt-order list in the spec is the *logical* contents of a seeded conversation after compact, not a per-drain assembler.
