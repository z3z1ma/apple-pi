Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Advisor gets primary recall tools and a rolling settled-advice list

## Context

The framed-context decision used the observational-memory snapshot as a substitute for deep history and kept nudges only on the hold-and-reconfirm preamble. The operator then required two additions: the advisor must be able to recover original transcript behind a snapshot id and search the main session, and it should retain a rolling record of nits, concerns, and blockers it has already raised.

The existing `memory_source` and `session_search` tools read `ctx.sessionManager` from the calling session. The advisor is a nested `Agent`, not that session. Handing it the unmodified tools would search the wrong conversation or fail.

## Decision

Amend `decisions/om-snapshot-prefix-curator-frame.md` points 6 and 8. The rest of that decision stands.

1. **Primary-bound recall.** The advisor SHALL have `memory_source` and `session_search` with the same product semantics they have for the primary agent. Execute them against the **primary** session branch and session file, using a binding captured from the root extension. They MUST NOT search the advisor's private message list.
2. **When to use them.** `memory_source` expands a specific snapshot id. `session_search` finds primary transcript or file-operation history that is no longer in the frame. They count toward the existing lean exploration budget (2–3 tool calls per review, deeper only for a critical bug). They are not a license to reload the compacted session every review.
3. **Rolling settled advice.** Keep the last **8** distinct settled advisor notes (nit, concern, or blocker), oldest dropped, with severity and disposition (`delivered` or `dropped`). This list is anti-repeat and orientation. It is not the hold-and-reconfirm mechanism.
4. **Split from live holds.** Currently held notes appear only in the existing reconfirm preamble. They join the rolling list when they settle (steered in, or dropped by silence). A note MUST NOT appear in both places at once.
5. **Lifetime.** The rolling list survives primary compact and frame roll. Session identity change (start, tree, handoff) and `reset()` clear it with the advice queue.
6. **Recall stays in the conversation.** Successful `memory_source` / `session_search` results live in the nested agent's messages like any other tool turn. They are dropped only when the conversation is reset. Do not keep a parallel scratch list or rebuild them on the next drain.

The parent decision's "snapshot is evidence" stance is unchanged. Recall is how the advisor checks a compressed claim; it does not make the snapshot binding.

## Authority And Provenance

Operator, same design session, after the framed-context records: supply the two recall tools, and keep a rolling number of raised nits, concerns, and blockers.

## Alternatives Considered

**No recall tools (parent decision point 6).** Steelman: keeps the advisor lean and avoids binding nested tools to the primary session. Rejected by the operator. Without them the snapshot cannot be verified once the frame has rolled.

**Register the stock tools unchanged.** Steelman: one implementation, no wrappers. Rejected because `execute` uses `ctx.sessionManager`; the nested advisor agent is not the primary session.

**Give the advisor `memory_source` only.** Steelman: ids in the snapshot are the common case; session search is broader and more expensive. Rejected; the operator asked for both recall paths.

**Only hold-and-reconfirm (parent decision point 8).** Steelman: live concerns already come back; delivered nits are supposed to be one-shot. Rejected; the operator wants a rolling record across severities so the advisor can see what it already said after holds clear and frames roll.

**Put live holds and settled notes in one list.** Steelman: one section to maintain. Rejected because reconfirm requires the "raise again or stay silent" protocol, which is the wrong instruction for already-settled notes.

**Unbounded session-long advice log.** Steelman: never forget a prior warning. Rejected as another accumulator. Depth 8 is a starting default.

## Consequences

- Implementation must wrap or rebind the two recall tools onto the primary `sessionManager` / session file known to the root advisor extension.
- Settled advice is re-injected at the next seed so a reset conversation still knows what was already said.
- Identity-change rebuilds start with an empty rolling list.
- The 8-note depth is a named knob, like the 96k frame cap.

## Limits And Revisit Conditions

- Revisit depth 8 if repeats return or the list crowds the prefix.
- Revisit the 2–3 tool-call budget if primary-bound search is too tight for real reviews.
- If primary binding cannot be done without a second recall implementation, stop and redesign; do not fork search semantics.

## Related Records

- `decisions/om-snapshot-prefix-curator-frame.md` (amended, still active)
- `specs/advisor-context-frame.md`
- `knowledge/advisor-frame-vocabulary.md`
