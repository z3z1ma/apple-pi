Status: active
Created: 2026-08-18
Updated: 2026-08-18

# The advisor is a regular session; only two things change

## Context

The design had accumulated a private conversation budget (96,000 formatted tokens), a custom drain-time overflow check, and a plan to invoke compact ourselves so that hook would fire at 96k instead of at Pi's window-minus-reserve. That is a second clock.

The operator's last refinement: drop it. The advisor is a regular session operating at a higher level. Lean tool results keep it strategic. When Pi would compact any session, our handler reseeds instead of summarizing. Two changes. Keep it stupid simple.

## Decision

Supersede the private 96k clock in `advisor-resets-on-its-own-budget.md` (point 3), `advisor-compaction-override.md` (point 3), and `om-snapshot-prefix-curator-frame.md` (point 4).

The advisor conversation is an ordinary accumulating session. Implementation changes two things only:

1. **Lean trajectory deltas** at push time, per `decisions/observation-receipts.md`. That is what keeps the session high-level: reasoning and tool intent stay; observations become receipts; edit diffs stay whole.

2. **A `session_before_compact` handler on the advisor session**, same seam VCC uses on the primary, different body. It MUST NOT summarize or compile the advisor conversation. It MUST return the seed already specified: live curator fold, recent user messages, recent primary trajectory, rolling settled advice. Prior advisor deltas are gone. Pending primary deltas drain after compact.

Pi's default compact trigger (`contextTokens > contextWindow - reserveTokens`) is the clock. There is no `ADVISOR_COMPACT_AT`, no formatted-token cap, and no drain-time "would this exceed 96k" check. Do not fake `contextWindow`.

Everything else from the earlier decisions stays: curator writes do not touch the advisor; identity change is still `reset()`, not this hook; the handler is not VCC; `transformContext` is not a reseed path; user text appends; recall dies with compact.

## Authority And Provenance

Operator, same design session, after the compaction-override write-up: no 96k budget; regular session; two changes (tool handling + reseed compact). Guiding principle stated as keep it stupid simple.

## Alternatives Considered

**Keep the 96k private clock (previous decision).** Steelman: a 1M-window advisor otherwise grows toward the window, which is the original complaint about percent-of-window self-compaction; 96k forced a strategic reset. Rejected: it is a second compaction system, and the operator now wants the session's own compact. Lean deltas are the bound on noise; the window is the bound on length.

**Keep `#softReset` / `ADVISOR_COMPACT_AT`.** Steelman: already works on today's bare Agent. Rejected: wipes without reseeding, and is still a private machine.

**Let Pi's default LLM summarizer run.** Steelman: zero handler code. Rejected: the compact must reseed from parent observational memory, rolling notes, and user trajectory, not compile the advisor chat.

**Drip-evict oldest deltas.** Steelman: never throw the conversation away. Rejected earlier; compact still means a new conversation.

## Consequences

- On a large-window advisor model the conversation can grow until Pi would compact any session. That is accepted. Quality of reviews in a long lean conversation versus a 96k reset is **Not verified**.
- Implementation still needs a compactable advisor session that does not load VCC. The trigger is no longer ours.
- A batch that cannot fit after compact still fails visibly. That is overflow recovery, not a private budget.

## Limits And Revisit Conditions

- Revisit a private cap only with a new operator decision, and only after lean deltas plus normal compact have been observed.
- If a compactable advisor session cannot be created without inheriting VCC, stop and redesign.
- Do not restore `#softReset` or `ADVISOR_COMPACT_AT` as a second reset path.

## Related Records

- `decisions/advisor-compaction-override.md`
- `decisions/advisor-resets-on-its-own-budget.md`
- `decisions/observation-receipts.md`
- `decisions/lean-trajectory-deltas.md`
- `specs/advisor-context-frame.md`
- `knowledge/conversation-not-a-frame-machine.md`
