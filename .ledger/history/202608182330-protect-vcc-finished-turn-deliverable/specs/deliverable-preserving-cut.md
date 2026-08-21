Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Deliverable-preserving compaction cut

## Purpose And Authority

Governs how VCC chooses `firstKeptEntryId` and what `compile()` must retain
in the summarized prefix. This is the behavioral contract for long-horizon
compaction. Only this active spec plus the owning task govern execution.

## Actors And Boundaries

- **VCC `buildOwnCut`** chooses the summarized prefix and kept suffix.
- **VCC `compile()`** renders the prefix. It is not a substitute for keeping
  the deliverable.
- **Pi** applies `firstKeptEntryId` as a single suffix. VCC must not assume
  it can keep non-contiguous messages.
- **Proactive waterline** may request compact. It must not request a compact
  that `buildOwnCut` would cancel.

## Required Behavior

- A **deliverable** is the last live assistant message with at least 1500
  characters of text content. If none exists, the last assistant message is
  the deliverable.
- The kept suffix MUST include the deliverable on every non-overflow compact
  that succeeds.
- `firstKept` is the start of the longest suffix that (1) includes the
  deliverable and (2) fits `maxKeptTokens` when a budget is provided. It is
  not automatically the deliverable index.
- When a last user message starts a turn that already contains the
  deliverable and that turn fits the budget, keep from that user (older
  turns are summarized).
- When the deliverable sits *before* the last user (the write-up is in an
  earlier turn), keep from the deliverable so a follow-up like "do it"
  cannot file the write-up.
- After a compact whose first kept entry is still the live start, if no user
  message was appended after that compaction, a non-overflow compact MUST
  cancel. It MUST NOT mid-cycle the tail or move `firstKept` to the
  deliverable (that would compile the evidence prefix).
- Overflow MAY move the keep forward from a long write-up to the last
  assistant envelope when the write-up suffix cannot fit.
- `compact-all` MUST NOT run while a ≥1500-character write-up exists.
- `compile()` of the prefix is governed by `compiled-prefix-budget.md`: one
  token budget after merge, not per-role word or line caps.

## Error And Failure Behavior

- No live messages → cancel `no_live_messages`.
- Two or fewer live messages → cancel `too_few_live_messages`.
- A successful cut that would summarize zero messages → cancel
  `nothing_safe_to_summarize`.
- These cancels MUST NOT change `firstKeptEntryId` or rewrite the tail.

## Given-When-Then Scenarios

- Given a single user prompt and an hour of tools ending in a long write-up,
  when compact runs with a keep budget, then the write-up is kept and
  `firstKept` is as early as the budget allows.
- Given that compact already kept a tail and the user has not spoken since,
  when a non-overflow compact is requested, then the tail is not mid-cycle
  shredded.
- Given a long write-up then a new user "do it", when compact runs, then
  the write-up remains in the keep suffix.
- Given only short tool-call assistants and one oversized cycle, when the
  suffix cannot fit, then compact-all remains allowed.

## Acceptance Mapping

- AC-001, AC-002, AC-003, AC-004, AC-006 → this spec's required and failure
  behavior.
- AC-005 superseded by AC-007–AC-009 → `compiled-prefix-budget.md`.

## Exclusions

- Observational-memory fold content.
- Changing when the 68% waterline fires, other than skipping a canceling cut.

## Assumptions And Provenance

- Single-cut suffix model: Pi `buildSessionContext`.
- Pre-prompt compact happens before the new user message is appended.

## Related Records

- `decisions/suffix-includes-last-writeup.md`
- `plans/implementation.md`
