Status: done
Created: 2026-08-21
Updated: 2026-08-21

# Integrate Fleet navigation hint into the input card

## Intent

Preserve Fleet navigation guidance without allowing it to create a dedicated second row beneath the zen input card.

## Outcome

When top-level agents are visible, Fleet publishes its current inactive or active navigation hint into the Apple Pi input card, where it shares the model/provider/thinking metadata row on the right. The below-editor Fleet widget begins directly with the roster.

## Scope

- Move the inactive `esc to interrupt · ← for agents · ↓ to manage` hint and its active navigation counterpart out of Fleet's below-editor widget.
- Present the current hint right-aligned opposite model/provider/thinking metadata through Pi's existing extension-status bridge.
- Preserve Fleet key handling, roster rendering, lifecycle cleanup, responsive width guarantees, and non-TUI compatibility.
- Update focused component tests and the input-card feature contract.

## Non-goals

- Redesigning Fleet rows, navigation keys, model metadata, or the compact telemetry strip.
- Adding another direct dependency or private integration between the subagent and input-card components.
- Showing Fleet navigation guidance when no eligible top-level agent is visible.

## Acceptance Criteria

- AC-001: With an eligible top-level agent visible, the input card renders the current Fleet navigation hint on the metadata row opposite model/provider/thinking when width permits, without duplicating it in the compact status strip.
- AC-002: Fleet's below-editor widget no longer emits a hint row or its spacer and begins with the `main` roster row.
- AC-003: Entering and leaving Fleet navigation updates the integrated hint between inactive and active guidance without changing key behavior.
- AC-004: Every input-card and Fleet row remains ANSI-aware and bounded by terminal width; narrow layouts preserve model identity before lower-priority hint detail.
- AC-005: Removing, disabling, rebinding, or disposing Fleet clears the hint, and non-TUI behavior remains unchanged.

## Constraints

- Preserve all existing uncommitted work; this task owns only the focused Fleet, input-card, documentation, test, and Ledger changes.
- Reuse Pi's public footer status data as the cross-component integration boundary.
- Preserve native editor delegation and existing extension status presentation.

## References

- `docs/status-footer.md`
- `components/status-footer/src/ui/input-card.ts`
- `components/status-footer/tests/status-footer.test.ts`
- `components/subagents/src/ui/fleet-list.ts`
- `components/subagents/tests/subagent-fleet.test.ts`
- `.ledger/history/202608202232-redesign-input-area-information-layout/task.md`
- `.ledger/history/202608211154-colorize-input-card-editor/task.md`
- `evidence/2026-08-21-verification-and-review.md`
- `retrospective.md`
