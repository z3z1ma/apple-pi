Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# Verification and review

## Purpose

Verify AC-001 through AC-005 and record independent review disposition for the Fleet navigation-hint integration.

## Source and environment

- Working tree: `main` against `HEAD`, with unrelated pre-existing modifications preserved.
- Runtime: repository-declared Node.js/Vitest/Biome toolchain.
- Changed production paths: `components/subagents/src/ui/fleet-list.ts`, `components/status-footer/src/ui/input-card.ts`.

## TDD observations

- RED: `npx vitest run components/subagents/tests/subagent-fleet.test.ts components/status-footer/tests/status-footer.test.ts` failed because Fleet did not publish `subagents-navigation`, the widget still contained the dedicated hint row, and the input card did not place the hint on the metadata row.
- GREEN: the same focused command passed after the producer/consumer integration.
- Review RED: the no-model regression test failed because the hint created a standalone row when model metadata was unavailable; it passed after `renderMetadataRow` required valid metadata.
- Rebind RED: the replacement-UI regression test failed because `setUICtx()` cleared the old status but did not publish to the replacement UI; it passed after `setUICtx()` synchronously called `update()`.

## Final verification

- `npx biome check components/subagents/src/ui/fleet-list.ts components/subagents/tests/subagent-fleet.test.ts components/status-footer/src/ui/input-card.ts components/status-footer/tests/status-footer.test.ts` — passed with no findings.
- `npm run typecheck` — passed.
- `npx vitest run components/subagents/tests/subagent-fleet.test.ts components/status-footer/tests/status-footer.test.ts` — 53/53 passed.
- `git diff --check -- <task paths>` — passed.
- First `npm test` run: 693/694 unit tests passed; `tests/ledger-visual-companion.test.ts` timed out in an unrelated WebSocket test.
- Isolated rerun of that exact test — 1/1 passed.
- Fresh full `npm test` rerun — 695/695 unit tests, 110/110 Advisor checks, and the package loader passed.

## Acceptance mapping

- AC-001: input-card tests verify one right-aligned metadata-row hint and no compact-strip duplicate.
- AC-002: Fleet tests verify the widget starts with `main` and contains no local hint.
- AC-003: Fleet tests verify inactive/active status transitions while existing navigation tests remain green.
- AC-004: focused renderer width tests remain green; the new test verifies narrow layouts retain complete model metadata and omit the hint.
- AC-005: tests verify disable cleanup and immediate old-to-new UI status migration; source review covered no-agent and dispose cleanup. The installer remains TUI-gated and no non-TUI code changed.

## Independent review

The whole-change review covered all six task paths. It confirmed one material defect: a Fleet-only row appeared when model metadata was absent. That defect was reproduced and fixed. An advisor then identified immediate replacement-UI publication as an uncovered lifecycle risk; it was reproduced and fixed.

A focused remediation review independently confirmed both fixes from source and found no remaining defect. One of two focused reviewer workers failed to return its typed result, but the other reviewer covered both fixes and the independent verifier confirmed both remediations. Remaining coverage notes were limited to exact-width threshold and broader synthetic lifecycle cases; the final full suite and focused behavioral tests cover the contracted production paths.

## Limits

- No live terminal screenshot was captured in this run.
- The special producer emits fixed plain text; arbitrary ANSI-bearing values under the reserved key are not part of the contract.
- A future Pi lifecycle that replaces a live extension UI context without calling `setUICtx()` or disposing the extension would require renewed lifecycle analysis.
