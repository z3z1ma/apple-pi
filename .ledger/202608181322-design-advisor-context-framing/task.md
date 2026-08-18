Status: open
Created: 2026-08-18
Updated: 2026-08-18

# Design advisor context framing

## Scope

Settle, on paper, what the advisor's context should be — then stop. The outcome of this task is
an active spec plus a decision record, not an implementation.

The advisor currently accumulates every turn delta into one private conversation and self-compacts
at 80% of its own context window. That percentage-of-window rule scales badly as windows grow
(~160k on a 200k model, 400k on a 500k model, 800k on a 1M model) and it treats the whole history
as equally valuable, when the operator's stated requirement is narrower: the advisor must know the
user's trajectory and intent, and can otherwise work from a recent tail.

The operator has explicitly reserved this design for a joint session. Do not implement, and do not
change `ADVISOR_COMPACT_AT`, ahead of that decision.

## Non-goals

- Implementing any of it. This task ends at an active spec and a decision.
- Changing when reviews fire; that is `.ledger/202608181322-coalesce-advisor-reviews/task.md`.
- Changing severity policy, hold-and-reconfirm, delivery, or the bounded catch-up wait.
- Adopting the reference implementation's non-blocking dispatch model, parked separately in
  `.ledger/history/202608181148-advisor-ux-reviewing-state-footer-bordered-advisory-card/`.
- Advisor cost ceilings or spend caps.

## Acceptance Criteria

- AC-001: The spec states how user intent is preserved, covering the message that starts a turn
  *and* every subsequent steering message, and states what happens when the user changes direction
  entirely rather than refining.
- AC-002: The spec defines the context structure — what is anchored and never evicted, what rolls,
  and what is discarded — and justifies it against the alternative of a plain sliding tail.
- AC-003: The spec defines the summarisation contract: what produces a window summary, how many
  are retained, where they sit in the prompt, and what happens when summarisation fails.
- AC-004: The spec defines which prior nudges are carried forward and how they relate to the
  existing hold-and-reconfirm mechanism, which already re-offers live concerns and blockers.
- AC-005: The spec states the expected prompt-cache behaviour of the chosen structure, including
  what invalidates the cached prefix and roughly how often.
- AC-006: A decision record chooses framed, sliding, or status quo, with steelmanned alternatives
  and consequences — or explicitly defers with named revisit conditions.
- AC-007: Failure boundary — the spec says what the advisor does when a single frame cannot fit,
  and that behaviour degrades visibly rather than silently reviewing less than it appears to.

## Work Items

- [x] WI-001: Research how the reference implementation manages advisor context.
      Recorded in `research/pi-advisor-context-management.md`. Result: nothing adoptable; it uses
      a newest-first byte tail with a fraction-of-window private budget, preserves intent only by
      instruction, authors no summaries, re-injects no prior nudges, and has no caching design.
- [ ] WI-002: Draft the spec covering AC-001 through AC-005 and AC-007.
- [ ] WI-003: Hold the design session with the operator.
- [ ] WI-004: Record the decision, including what was rejected and why.

## References

- `research/pi-advisor-context-management.md`
- `.ledger/202608181322-account-sidecar-model-usage/task.md` — measured baseline; the advisor is
  the one plausibly-large sidecar and is currently unmeasured, so this design is being made
  without cost evidence until that lands
- `.ledger/202608181322-coalesce-advisor-reviews/task.md` — adjacent, deliberately separate
- `components/advisor/src/extension.ts:1044` — `ADVISOR_COMPACT_AT`, the rule under review
- `components/advisor/src/extension.ts:588-713` — current drain, reconfirm preamble, and
  proactive/reactive self-compaction
- `components/advisor/src/extension.ts:975-1040` — reprime from Pi's active context
- `docs/advisor.md`

## Assumptions

- The advisor's value comes primarily from recent trajectory plus durable user intent, not from
  deep history. **Not verified** — it is the operator's stated model and the premise of the whole
  design, but no experiment has tested advice quality against history depth.
- Steering messages sent mid-turn are distinguishable from the turn's kickoff message.
  **Partially verified** 2026-08-18. A structural discriminator exists and needs no heuristic:
  `agent_start` fires once per user request and resets `_turnIndex`, `agent_end` closes it, and
  `turn_end` fires per assistant step in between
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:440-464`); our
  advisor already captures the kickoff separately at `before_agent_start` via `event.prompt`
  (`components/advisor/src/extension.ts:1068-1077`). So the kickoff is known, and anything
  arriving before `agent_end` is mid-turn.
  Mid-turn steers **do** surface as ordinary user-role session entries. **Verified** 2026-08-18
  by classifying every user entry in the 15 most recent sessions by its predecessor entry:
  15 session-opening, 15 preceded by a terminal assistant message (kickoffs), and 2 preceded by
  a `toolResult` — genuine mid-run steers, e.g. "Actually it could also be advisor."

  Method note for whoever specifies this: an earlier scan looking for *consecutive* user-role
  entries returned zero and was invalid — a mid-run steer is always followed by the assistant's
  next step, so its predecessor is never another user entry and zero was guaranteed regardless
  of ground truth. The correct discriminator is the predecessor: a user entry preceded by an
  assistant message carrying tool calls, or by a `toolResult`, is a mid-run steer; one preceded
  by a terminal assistant message (no tool call — the same test the advisor already uses for
  terminality) is a kickoff.

  One refinement remains for the spec: 7 user entries in that scan were preceded by `om.*` or
  `advisory` custom entries, which are appended asynchronously and so mask the real predecessor.
  The discriminator must skip custom entries and look back to the last message entry.
  Advisor-originated steers land as `custom` entries with `customType: "advisory"` and are not
  user-role entries, so they do not pollute this classification.

## Journal

- 2026-08-18: Created from a chat-only design discussion. Operator's sketch: pin the turn-kickoff
  message plus all steering messages as durable intent; run a recent tail of the transcript;
  summarise each window as it closes and roll a few summaries plus the last few nudges into the
  next window; prefer a fixed anchor with a bounded frame over a sliding window, so the prefix
  stays cacheable until the frame rolls.
- 2026-08-18: Reference research completed. It does not solve any of the three goals, so this is
  design work rather than adoption.

## Blockers

Blocked on the operator design session (WI-003), by explicit instruction. The second assumption
above should be verified before that session so the discussion starts from fact.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
