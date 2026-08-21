Status: cancelled
Created: 2026-08-18
Updated: 2026-08-19

# Protect finished-turn deliverables in VCC compaction

## Scope

VCC compaction must keep a finished long-horizon deliverable usable after
ambient, pre-prompt, and follow-up compaction. One cut still compiles a
prefix and keeps a suffix. The suffix always includes the last substantial
assistant write-up when one exists, fills the keep budget backward with
recent evidence, and does not mid-cycle or 1–9 shred a tail that a prior
compact already chose unless overflow recovery requires it. `compile()` spends one
window-derived token budget on the prefix (headers + brief + merge).

## Non-goals

- Changing the 68% usage waterline or observational-memory curator timing.
- In-place rewriting of kept tool results (single `firstKeptEntryId` cut remains).
- LLM summarization, a second compaction owner, or Pi core patches.
- Advisor context framing.

## Acceptance Criteria

- AC-001: When live messages include an assistant write-up of at least 1500
  text characters, that message is never in the summarized prefix except on
  overflow when even that write-up plus its trailing messages exceed the keep
  budget and a later assistant envelope is the only remaining keep.
- AC-002: A first compact of a single-user or last-user-at-0 investigation
  does not cut at a message-count midpoint. `firstKept` is the start of the
  longest suffix that fits `maxKeptTokens` and still includes the deliverable.
- AC-003: After a compact whose `firstKeptEntryId` is still the live start,
  and no new user message exists after that compaction, a non-overflow compact
  cancels. It does not mid-cycle, 1–9 shred, or jump `firstKept` to the
  write-up.
- AC-004: `compact-all` (`firstKeptEntryId=""`) does not run when a
  substantial write-up exists.
- AC-005: Superseded by AC-007. Recency word tiers and 8×500 excerpts are
  not the compile policy.
- AC-006: Failure — fewer than three live messages, or a compact that would
  summarize nothing without dropping the deliverable, cancels with a defined
  reason and does not rewrite the tail.
- AC-007: `compile()` applies one token budget to headers + brief + merge:
  `min(keep/10, dropped/10, leftover overhead)`, floor 512. No per-role word
  cap, tool-call count cap, or 120-line `capBrief`.
- AC-008: User intent and tool errors are pinned; remaining space fills
  backward. A result that does not fit is omitted whole, not prefix-clipped.
- AC-009: Failure — successive merges do not grow the compiled artifact
  past that budget.

## Work Items

- [x] WI-001: Extract `buildOwnCut` and replace mid-cycle / compact-all defaults
      with deliverable-preserving suffix selection.
- [x] WI-002: Brake subsequent non-overflow compact of an already-kept tail.
- [-] WI-003: Cancelled: recency word tiers and 8×500 excerpts were a second
      invented cap set; replaced by WI-006.
- [x] WI-004: Skip proactive `ctx.compact()` when `buildOwnCut` would cancel.
- [x] WI-005: Tests and `docs/context.md` for the keep invariant.
- [x] WI-006: Replace compile word/line/count caps with one packed token budget.

## References

- `.ledger/202608182330-protect-vcc-finished-turn-deliverable/specs/deliverable-preserving-cut.md`
- `.ledger/202608182330-protect-vcc-finished-turn-deliverable/specs/compiled-prefix-budget.md`
- `.ledger/202608182330-protect-vcc-finished-turn-deliverable/decisions/suffix-includes-last-writeup.md`
- `.ledger/202608182330-protect-vcc-finished-turn-deliverable/decisions/one-compile-budget.md`
- `.ledger/202608182330-protect-vcc-finished-turn-deliverable/plans/implementation.md`
- `components/vcc/src/hooks/before-compact.ts`
- `components/vcc/src/core/brief.ts`
- `components/vcc/src/core/pack-brief.ts`
- `docs/context.md`

## Assumptions

- Pi compaction is a single `firstKeptEntryId` cut; the keep set is always a
  suffix. Record-backed by `buildSessionContext` in pi-coding-agent.
- `ctx.compact()` from the proactive hook is Pi's manual compact path
  (`reason: "manual"`). Protective mode therefore keys off overflow vs
  everything else, not the label "manual".
- Pre-prompt `_checkCompaction` runs before the new user message is appended.
  User-ratified by this session's Pi `agent-session.js` read.

## Journal

- 2026-08-18: Created the task bundle; shaping remains incomplete.
- 2026-08-18: Specified deliverable-preserving cut, compile recency, and
  already-kept-tail brake. Implementation started.
- 2026-08-18: Landed `own-cut.ts`, compile recency, proactive skip. VCC Bun
  suite 478 pass / 0 fail. Live session replay of an hour-long analysis is
  still Not verified.
- 2026-08-19: Replaced compile word/line/count caps with one packed token
  budget. VCC Bun suite 485 pass / 0 fail.

## Blockers

None.

## Evidence

- AC-001–AC-004, AC-006: `components/vcc/tests/before-compact.test.ts`
  deliverable-protection cases and updated last-user-0 / no-user cuts.
- AC-003 + WI-004: proactive test “already-kept tail has no new user” does
  not call `ctx.compact()`.
- AC-005: superseded; old recency-tier tests removed.
- AC-007–AC-009: `pack-brief.test.ts`, `compile.test.ts` merge pack, 100-compaction
  stress plateau (~8k chars under the default 2k-token budget).
- Suite: `bun test components/vcc/tests` — 485 pass, 0 fail. `tsc --noEmit` clean.
- Not verified: a real idle-after-analysis then “do it” session; live reload of
  this checkout.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
