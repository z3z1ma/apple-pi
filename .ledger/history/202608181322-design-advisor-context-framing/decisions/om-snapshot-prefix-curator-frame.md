Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Observational memory is the advisor prefix; curator coverage writes roll the frame

## Context

The advisor today accumulates every primary-turn delta in a private conversation and self-compacts at 80% of its own `contextWindow`. That percentage grows with advertised windows and treats every old tool result as equal to the user's live intent. The operator required a joint design before changing that rule.

A framed window with advisor-authored summaries was the original sketch. During the design session the operator proposed putting observational-memory current law, and possibly visible observations, at the start of advisor context so the already-maintained ledger could replace deep delta history. The cache objection followed immediately: visible observations can change every curator pass (~20k primary source tokens), which would invalidate a live-refreshed prefix as often as the cheaper model writes.

Sidecar usage now exists, but this decision is still being made without a measured advisor-token baseline. It is a coordination and context-shape decision, not a claimed quota saving.

## Decision

Choose a **framed** advisor context, not a sliding tail and not the status-quo accumulator.

1. **Substitution, not addition.** The ledger prefix replaces accumulated deep history and the `formatActiveSessionContext` reprime dump. It is not prepended on top of today's full private transcript.
2. **Prefix contents.** Current law plus all visible observations, captured as one **ledger snapshot at advisor conversation start** and held steady until the next conversation start. Live ledger mutations, including curator persists, MUST NOT rewrite the prefix. Clock amended by `decisions/advisor-resets-on-its-own-budget.md`.
3. **Frame clock.** The working frame is already-reviewed advisor-formatted deltas since this advisor conversation started. Unreviewed deltas are the drain batch and MUST NOT also be rendered as frame. Curator passes do not roll the frame. Amended by `decisions/advisor-resets-on-its-own-budget.md`.
4. **Overflow.** Pi compact on the advisor session starts a **new advisor conversation**: fresh live-fold snapshot, empty frame, empty scratch. Do not drip-delete oldest deltas. Private 96k budget superseded by `decisions/advisor-is-a-regular-session.md`.
5. **User intent.** User text is ordinary conversation, not a live pin object. New kickoffs and steers append when they arrive. At conversation start only, collect the current request plus the two most recently completed requests from the primary session. A full direction change is a newer user message. Live user text and recent deltas outrank the snapshot. Amended 2026-08-18: the operator rejected treating pins as a special mid-conversation structure.
6. **Stance.** The snapshot is orientation, not authority. Do not inject the primary's "Honor current law" compaction instructions. The advisor may contradict the curator. How it inspects a compressed claim is amended by `decisions/advisor-recall-and-rolling-notes.md`: primary-bound `memory_source` and `session_search`.
7. **No advisor-authored window summaries.** The curator is the only summariser. Its fold is read only at advisor conversation start. A curator persist is not a snapshot refresh.
8. **Nudges.** Live holds ride the existing hold-and-reconfirm preamble. Settled nits, concerns, and blockers ride a rolling list of depth 8, per `decisions/advisor-recall-and-rolling-notes.md`.
9. **Primary compaction** is not an advisor frame boundary and MUST NOT wipe framed advisor state or dump the primary active context into the advisor. Session identity change (session start, tree navigation, handoff) rebuilds snapshot from the live fold, collects recent user messages from the new session, and starts an empty frame.
10. **Self-compaction at `ADVISOR_COMPACT_AT`** is superseded by the advisor session's compact handler. A single batch that still cannot fit after compact fails the review visibly.

Scheduling of the model call remains `.ledger/202608181322-coalesce-advisor-reviews/`. This decision does not defer drain.

## Authority And Provenance

Operator design session 2026-08-18, recorded against this task and the coalesce sibling.

Ratified in that session:

- Prefix leans law + all visible observations, held steady until the frame ends.
- Working frame was first described as "since last curator pass"; corrected the same day to advisor-budget reset only. See `decisions/advisor-resets-on-its-own-budget.md`.
- Last few user messages at seed time are the current request plus two completed requests; mid-conversation they just append.
- Stance is evidence; recent work wins.

Source-backed constraints:

- `pendingUserPrompt` is consumed on the first `turn_end`, so mid-turn steers are not first-class in live advisor deltas today and must become ordinary appended user messages.
- Curator empty results write nothing and do not advance coverage.
- `idle` is no in-flight drain and an empty pending queue; coalescing must not wait on a drain that was never started.

## Alternatives Considered

**Status quo (accumulate deltas, soft-reset at 80% of window).** Steelman: it already works, needs no OM coupling, and the advisor sees exactly what the primary just did. Rejected because the budget scales with advertised windows, self-compaction discards everything including intent, and reprime dumps the entire active primary context.

**Sliding recent tail (pi-advisor family).** Steelman: simple, newest user text naturally survives, no summariser to fail. Rejected because it preserves intent only by accident of recency, has no pin, and the reference implementation independently chose a fraction-of-window budget with the same growth defect.

**Framed windows with advisor-authored summaries (original operator sketch).** Steelman: the expensive model writes its own orientation, so the prefix is in the advisor's voice and does not depend on Luna. Rejected for this revision because it adds Opus/high-thinking summariser calls, and the curator already maintains current law plus a budgeted observation pool on a 20k clock. Revisit if snapshot quality is too low for review.

**Law-only prefix, observations omitted.** Steelman: smallest, most cache-stable prefix; observations change more often than reflections. Rejected by the operator in favor of holding the full visible set steady for the frame, which keeps the substitute for dropped history without mid-frame prefix churn.

**Live-refresh the prefix whenever the ledger changes.** Steelman: advisor always sees the latest fold. Rejected because that is the cache-invalidation problem the operator called out; a curator persist is not an advisor refresh.

**Include the VCC conversational summary in the prefix.** Steelman: after primary compact, narrative that never became law would otherwise vanish. Deferred. Primary compact no longer wipes the advisor's own frame, so the advisor still has its framed deltas. Revisit if identity-change rebuilds feel blind.

**Pin every user message for the whole session.** Steelman: law can lag a pivot by up to one curator interval. Rejected as unbounded. Seed collects the current request plus two completed ones; older goals survive only if they are still in the snapshot.

**Treat the snapshot as binding, like the primary after compact.** Steelman: one shared worldview, fewer advisor nits that fight current law. Rejected because the curator is a cheaper model and the advisor's job includes catching wrong orientation. Live user text and recent deltas outrank the snapshot.

## Consequences

- Advisor context becomes OM-coupled for quality but not for enablement: empty or disabled observational memory yields an empty snapshot; review continues from recent user messages and the accumulating conversation.
- Cache is the accumulating conversation until Pi compact or identity change. Snapshot is seeded at conversation start and not rewritten by curator persists. User text appends when the user speaks. History appends until compact.
- Implementation must append mid-turn steers as ordinary messages, seed the fold only at conversation start / advisor compact, stop dumping primary context on primary `session_compact`, replace `#softReset` / `ADVISOR_COMPACT_AT`, and emit lean trajectory deltas per `decisions/lean-trajectory-deltas.md`.
- Advice quality versus history depth remains **Not verified**.

## Limits And Revisit Conditions

- A private formatted-token overflow cap is closed; see `decisions/advisor-is-a-regular-session.md`.
- Revisit snapshot-versus-advisor-authored summaries if review quality drops when the frame no longer contains the original evidence.
- Revisit including the VCC summary on identity-change rebuilds if those reviews are blind.
- Revisit recent-user-message depth if two completed requests are too little or too large.
- Do not revive `ADVISOR_COMPACT_AT` or a private formatted-token cap without a new operator decision. Pi compact is window-relative on purpose; that is not a private advisor budget.

## Related Records

- `specs/advisor-context-frame.md`
- `decisions/advisor-is-a-regular-session.md`
- `decisions/lean-trajectory-deltas.md`
- `knowledge/advisor-frame-vocabulary.md`
- `.ledger/202608181322-coalesce-advisor-reviews/specs/advisor-review-coalescing.md`
- `research/pi-advisor-context-management.md`
