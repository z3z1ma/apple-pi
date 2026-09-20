Status: complete
Created: 2026-09-19
Updated: 2026-09-20

# Retrospective

## What Mattered

A passive active-work surface and an explicit manager solve different problems. One shared above-editor renderer now gives subagents and managed tasks consistent live visibility without taking focus, while `/agents` and `/tasks` own inspection and control. Stable ID-based selection, active-only count semantics, and transcript-owned terminal outcomes keep those surfaces coherent as work settles or reorders.

The work retained one implementation of each responsibility: domain modules produce rows, `components/shared/` owns rendering and navigation primitives used by both domains, and the input editor consumes only terse status values.

## Learnings

- Overlay height budgets must include headers, separators, footers, and very short terminals; a useful minimum can still overflow the actual viewport.
- Rendered key hints must come from the same configured bindings that handle input.
- Detail views should wrap complete operator inputs and full-output paths. Roster and passive summaries should collapse multiline text to one bounded preview line.
- Task active-state semantics belong in one domain function because cancellation, waiting, passive counts, roster ordering, and monitor delivery all depend on the same statuses.
- Theme invalidation and widget mounting are separate lifecycle states. Cleanup must remove a previously mounted widget even after its component was invalidated.

## Improvements

For future cross-domain TUI work, define the shared lifecycle and responsive-height contract before building individual views, then test the smallest supported terminal as well as the normal layout. This exposes ownership and chrome-budget errors before the richer flows depend on them.

## Verification

Passed on the final working tree:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test` — 94 unit files / 1057 tests, 121/121 pair tests, and loader checks
- `npm run pack:check`
- `git diff --check`
- `graphify update .`

The opt-in networked pair E2E was not run.
