Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Keep a budget-filled suffix that includes the last write-up

## Context

Idle and pre-prompt compact after a long investigation has no *new* user
boundary. The last-user cut either keeps an oversized turn (then a later
compact shreds it) or, when that user is live index 0, mid-cycle-cuts by
message count. Session JSONL shows first compacts usually keep the last
assistant envelope; later pi-vcc comps with `firstKeptRole=assistant` shrink
to 1–9 messages. `compile()` then stores earlier write-ups as 200 content
words and drops non-error tool results. Compact-all is the only path that
compiled a last assistant in the sampled sessions.

## Decision

Replace midpoint / default compact-all with: find the last substantial
assistant write-up (1500+ text chars, else last assistant); keep the longest
suffix that includes it and fits the keep budget; fill that budget backward
with recent tools and assistants. Do not set `firstKept` to the write-up
index just to "protect" it — that would compile the evidence in front.
On a previously-kept tail with no new user after the last compaction,
non-overflow compact may only cancel or jump to the deliverable — never
mid-cycle. Overflow may sacrifice an earlier write-up to keep the last
assistant envelope. `compile()` recency-weights what still falls off,
including recent result excerpts.

## Authority And Provenance

Operator: fix the compaction system systemically, not only the visible
smoke. Evidence: `buildOwnCut` in VCC, Pi `_checkCompaction` pre-prompt
ordering, sampled session compaction rows.

## Alternatives Considered

- **Disable ambient compact.** Stops the annoyance. Does not fix overflow
  or `/compact`, and leaves the cut wrong when compact must run.
- **Always firstKept = last long assistant.** Protects the write-up but
  compiles all supporting evidence in front of it even when the budget
  could keep that evidence. Rejected.
- **Cherry-pick assistants and drop only old tool dumps.** Requires
  non-contiguous keep, which Pi cannot do with one `firstKeptEntryId`.
  Rejected until a different host contract exists.
- **Keep last-user / mid-cycle and only enlarge `compile()`.** Leaves the
  1–9 shred and the "do it" last-user cut able to file the write-up.

## Consequences

- Single-user investigations compact earlier exploration first and keep the
  write-up plus as much recent evidence as fits.
- Follow-up user turns cannot use last-user-as-cut to file a still-live
  write-up.
- Sessions may stay above the 68% waterline when the protected suffix is
  already the minimum. Cost can remain high until overflow or a later turn
  grows something safe to summarize.
- `compile()` summaries get larger for recent prefix content; giant old
  dumps stay clipped.

## Limits And Revisit Conditions

Revisit if Pi gains a way to drop kept-region tool dumps without moving
`firstKept` past a write-up, or if 1500 characters mis-identifies
deliverables in practice.

## Related Records

- `specs/deliverable-preserving-cut.md`
