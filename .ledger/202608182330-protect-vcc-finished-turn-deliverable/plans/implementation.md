Status: done
Created: 2026-08-18
Updated: 2026-08-18

# Implementation plan

## Outcome

Deliverable-preserving `buildOwnCut`, compile recency, and a proactive skip
when the cut would cancel.

## Current-System Evidence

- `components/vcc/src/hooks/before-compact.ts` — last-user cut, mid-cycle
  at last-user index 0, oversized `findSuffixSplitPoint`, compact-all.
- `components/vcc/src/core/brief.ts` — `TRUNCATE_ASSISTANT = 200`, non-error
  tool results dropped.
- `components/vcc/src/hooks/proactive-threshold.ts` — `agent_settled`
  `ctx.compact()` with no cut preview.
- Pi `agent-session.js` — pre-prompt `_checkCompaction` before the new user
  message; `ctx.compact()` uses the manual path.

## Change Surfaces

- New `components/vcc/src/core/own-cut.ts` (cut algorithm; avoids an import
  cycle with the proactive hook).
- `components/vcc/src/hooks/before-compact.ts` — re-export, pass `reason`,
  shared keep-budget helper.
- `components/vcc/src/hooks/proactive-threshold.ts` — skip when cut cancels.
- `components/vcc/src/core/brief.ts` — recency budgets and result excerpts.
- `components/vcc/tests/before-compact.test.ts`, `brief.test.ts`.
- `docs/context.md` — what is kept.

## Sequence

1. Land `own-cut.ts` and switch the hook.
2. Update brief/compile truncation.
3. Skip proactive canceling cuts.
4. Rewrite tests that encoded mid-cycle / hide-all-results.
5. Update `docs/context.md`.
6. Run VCC Bun tests and format/lint on touched files.

## Acceptance And Backpressure

| AC | Class | Check |
| --- | --- | --- |
| AC-001 | invariant | unit: long write-up not in `messages` unless overflow last-resort |
| AC-002 | production behavior | unit: last-user-0 uses budget suffix, not midpoint |
| AC-003 | invariant | unit: already-kept tail without new user cancels or keeps deliverable |
| AC-004 | invariant | unit: no `compactAll` when long write-up exists |
| AC-005 | production behavior | brief unit: recent assistant >200 words; recent result excerpt present |
| AC-006 | failure boundary | unit: empty/too-few/nothing-safe cancel |

## Risks And Failure Modes

- Protected suffix larger than the window → overflow path must still recover.
- 1500-char threshold misses short-but-real write-ups → last assistant is
  the fallback deliverable.
- Larger compile excerpts grow the summary; keep dumps clipped.

## Integration Points

Same `session_before_compact` return shape. Observational memory still
augments the same cut.

## Rollback Or Recovery

Revert the cut module and brief recency; prior mid-cycle tests restore the
old heuristic.

## Related Records

- `specs/deliverable-preserving-cut.md`
- `decisions/suffix-includes-last-writeup.md`
