Status: active
Created: 2026-08-18
Updated: 2026-08-18

# Compiled prefix is one token-budgeted index

## Purpose And Authority

Governs how VCC `compile()` spends context on the summarized prefix.
This replaces per-role word counts, result excerpt windows, tool-call
line caps, and `capBrief` line shears.

## Actors And Boundaries

- **`compile()`** owns the only cap: one token budget for headers + brief + merge.
- **`buildBriefSections`** builds a lossless index (full user/assistant/result
  text, all tool one-liners, errors). It does not clip for budget.
- **`packCompiledArtifact`** applies the budget once, after merge.
- **`wrapLongLines`** is a TUI display pass after pack. It is not a signal cap.
- **Pi** still keeps a verbatim suffix. This spec is only the compiled prefix.

## Required Behavior

- The budget MUST be
  `min(keep/10, dropped/10, leftover overhead)`, floored at 512 tokens.
  Leftover overhead is half the reserved context overhead (the other half
  is left for system, tools, and observational memory, which are not
  measured here).
- User intent and tool errors are pinned. The first user message is kept
  before later users when the pin set does not fit.
- Remaining space fills backward. Assistant prose that does not fit MAY
  clip to a tail. A tool result that does not fit MUST be omitted whole,
  not prefix-clipped.
- Tool-call one-liners compete for leftover space. They MUST NOT have a
  separate count cap.
- Merge MUST reuse the same budget. A compiled artifact MUST NOT grow
  across successive compactions beyond that budget.

## Error And Failure Behavior

- A zero or negative budget yields an empty brief.
- Pathological pastes that exceed the pin budget are head-clipped, not dropped.

## Given-When-Then Scenarios

- Given a 1M-token window, when compile runs, then the summary is capped
  by leftover overhead (~16k), not by keep/10 (~47k).
- Given a 200k window, when compile runs, then the summary is keep/10
  (~6.7k), which is below leftover overhead.
- Given an 80k file read in the prefix, when it does not fit, then it is
  omitted and the Read one-liner plus Files And Changes remain.
- Given a long previous summary plus a new compact, when they merge, then
  the result still fits the same budget.

## Acceptance Mapping

- AC-007, AC-008, AC-009 → this spec.

## Exclusions

- Cut selection and the 1500-character deliverable heuristic.
- Observational-memory fold content.
- Header merge caps on Session Goal / Earlier Turns (unbounded-merge hygiene).

## Assumptions And Provenance

- Token estimate is chars/4, same as the cut.
- Operator rejected per-role word/line/count constants as the policy.

## Related Records

- `decisions/one-compile-budget.md`
